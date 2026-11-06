-- Run only when input is deliberately moving to the VPS after final sync.
BEGIN;
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT n.nspname, c.relname FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE t.tgname='rhi_preview_readonly' AND n.nspname IN ('public','storage')
  LOOP
    EXECUTE format('DROP TRIGGER rhi_preview_readonly ON %I.%I', item.nspname, item.relname);
  END LOOP;
END;
$$;
COMMIT;
