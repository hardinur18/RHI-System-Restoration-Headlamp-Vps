-- Only on the destination VPS. Auth sessions may change; business data may not.
-- The migration administrator can still apply a newer consistent snapshot.
BEGIN;
CREATE SCHEMA IF NOT EXISTS rhi_migration AUTHORIZATION supabase_admin;
REVOKE ALL ON SCHEMA rhi_migration FROM PUBLIC;
CREATE OR REPLACE FUNCTION rhi_migration.reject_preview_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'RHI sedang dalam mode baca. Input tetap di aplikasi lama.' USING ERRCODE = '25006';
  END IF;
  RETURN NULL;
END;
$$;
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname = 'public'
       OR (schemaname = 'storage' AND tablename IN ('objects', 'buckets', 'prefixes'))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS rhi_preview_readonly ON %I.%I', item.schemaname, item.tablename);
    EXECUTE format('CREATE TRIGGER rhi_preview_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION rhi_migration.reject_preview_write()', item.schemaname, item.tablename);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER rhi_preview_readonly', item.schemaname, item.tablename);
  END LOOP;
END;
$$;
COMMIT;
