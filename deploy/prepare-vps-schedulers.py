#!/usr/bin/env python3
"""Rehearse VPS scheduler configuration with rollback; --apply-inactive is for cutover.

Never starts jobs or touches the source. Run after the final delta, before enabling
the target scheduler and only after stopping source schedulers at cutover.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket

assert socket.gethostname().split('.')[0] == 'srv2126686' and os.geteuid() == 0
os.umask(0o077)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply-inactive', action='store_true')
args = parser.parse_args()
root = Path('/opt/rhi/migration')
spec = importlib.util.spec_from_file_location('delta', root / 'plan-delta.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
env = dict(line.split('=', 1) for line in Path('/opt/rhi/supabase/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
runtime = dict(line.split('=', 1) for line in (root / 'runtime.env').read_text().splitlines()
               if '=' in line and not line.startswith('#'))
dispatch_token = runtime['META_CONVERSION_DISPATCH_TOKEN']
assert len(dispatch_token) >= 32
db = delta.connection_target(admin=True)
try:
    with db.cursor() as cur:
        cur.execute('show cron.launch_active_jobs')
        assert cur.fetchone()[0] == 'off'
        cur.execute('select jobname, schedule, active, command from cron.job order by jobname')
        before = cur.fetchall()
        assert len(before) == 3 and all(not row[2] for row in before)
        assert {r[0] for r in before} == {'ads-daily-auto-sync', 'ads-daily-seven-day-reconcile', 'meta-conversion-dispatcher'}
        assert all('ads_sync_project_url' in row[3] for row in before)
        assert 'meta_conversion_dispatch_token' in next(r[3] for r in before if r[0] == 'meta-conversion-dispatcher')
        signature = 'public.configure_ads_daily_sync_cron(text,text,text)'
        cur.execute('select pg_get_functiondef(%s::regprocedure)', (signature,))
        original = cur.fetchone()[0]
        predicate = "p_project_url !~ '^https://[a-z0-9]+[.]supabase[.]co$'"
        target_predicate = "p_project_url <> 'https://api-rhi.polesheadlamp.id'"
        assert original.count(predicate) == 1 or original.count(target_predicate) == 1, 'Review changed scheduler function'
        cloud_definition = original.replace(target_predicate, predicate)
        assert hashlib.sha256(cloud_definition.encode()).hexdigest() == 'e45d63377a03e3c41ab59cd33300a56138c239f37c56623fcad33072fccfabc5', 'Scheduler definition drift; review before configuring'
        cur.execute(original.replace(predicate, target_predicate))
        scheduler_token = secrets.token_urlsafe(48)
        cur.execute('select public.configure_ads_daily_sync_cron(%s,%s,%s)',
                    ('https://api-rhi.polesheadlamp.id', env['ANON_KEY'], scheduler_token))
        assert cur.fetchone()[0]['configured']
        cur.execute("select id from vault.secrets where name='meta_conversion_dispatch_token'")
        existing = cur.fetchone()
        if existing:
            cur.execute('select vault.update_secret(%s,%s)', (existing[0], dispatch_token))
        else:
            cur.execute('select vault.create_secret(%s,%s)', (dispatch_token, 'meta_conversion_dispatch_token'))
        cur.execute('select cron.alter_job(jobid, active := false) from cron.job')
        cur.execute('select count(*) from cron.job where active')
        assert cur.fetchone()[0] == 0
        cur.execute("select name,decrypted_secret from vault.decrypted_secrets where name = any(%s)",
                    (['ads_sync_project_url', 'ads_sync_publishable_key', 'ads_sync_scheduler_token', 'meta_conversion_dispatch_token'],))
        saved = dict(cur.fetchall())
        assert saved == {'ads_sync_project_url': 'https://api-rhi.polesheadlamp.id',
                         'ads_sync_publishable_key': env['ANON_KEY'], 'ads_sync_scheduler_token': scheduler_token,
                         'meta_conversion_dispatch_token': dispatch_token}
        cur.execute("select scheduler_token_hash=encode(extensions.digest(%s,'sha256'),'hex') from public.ads_sync_runtime where id='daily-ads'", (scheduler_token,))
        assert cur.fetchone()[0]
    if args.apply_inactive:
        db.commit()
    else:
        db.rollback()
        with db.cursor() as cur:
            cur.execute('select pg_get_functiondef(%s::regprocedure)', (signature,))
            assert cur.fetchone()[0] == original
            cur.execute('select jobname, schedule, active, command from cron.job order by jobname')
            assert cur.fetchall() == before
    report = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'passed': True, 'applied_inactive': args.apply_inactive, 'rehearsal_rolled_back': not args.apply_inactive,
              'scheduler_function_before_sha256': hashlib.sha256(original.encode()).hexdigest(),
              'jobs': 3, 'active_jobs': 0, 'launcher_enabled': False, 'source_changed': False}
    (root / 'scheduler-preparation.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
finally:
    db.rollback()
    db.close()
