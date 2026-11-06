#!/usr/bin/env python3
"""Prepare private CSV exports, named Storage files and encrypted DB recovery.

Read only a restored rehearsal database and verified immutable backup inputs.
Never contacts production, uploads, changes sharing, or overwrites a package.
The complete DB archive is authoritative; CSV is a convenient reading copy.
"""
import argparse
import csv
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
from urllib.parse import quote

from psycopg2 import sql

spec = importlib.util.spec_from_file_location('delta', Path(__file__).with_name('plan-delta.py'))
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)

EXCLUDED = {
    'kv_store_f781cd00': 'Data campuran dan kredensial. Seluruh isi ada di backup pemulihan.',
    'ads_sync_runtime': 'Status penjadwal dan token. Seluruh isi ada di backup pemulihan.',
}
SECRET_NAME = re.compile(r'password|secret|access_token|refresh_token|api_key|authorization|private_key|lock_token|scheduler_token', re.I)
JSON_SECRET = re.compile(r'("(?:[^"\\]*(?:password|secret|access_token|refresh_token|api_key|authorization|private_key)[^"\\]*)"\s*:\s*)"(?:\\.|[^"\\])*"', re.I)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def component(value):
    """Reversible safe names, including empty/dot components and long keys."""
    encoded = quote(value, safe='-_. @()+')
    if encoded in ('', '.', '..'):
        encoded = '%' + value.encode().hex() if value else '%EMPTY'
    if len(encoded.encode()) > 220:
        encoded = encoded[:150] + '~' + hashlib.sha256(value.encode()).hexdigest()
    return encoded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('delta_snapshot')
    parser.add_argument('database_backup')
    args = parser.parse_args()
    assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    lock = open('/run/lock/rhi-readable-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    source, database = Path(args.delta_snapshot).resolve(), Path(args.database_backup).resolve()
    assert source.parent == Path('/opt/rhi/backups') and source.name.startswith('delta-')
    assert database.parent == Path('/opt/rhi/backups/daily-database')
    report = next((json.loads(p.read_text()) for p in database.glob('rhi_backup_rehearsal_*.json')
                   if json.loads(p.read_text()).get('all_matched')), None)
    assert report and report['archive_sha256'] == digest(database / 'postgres.dump')
    assert re.fullmatch(r'rhi_backup_rehearsal_\d+', report['database'])
    subprocess.run(['sha256sum', '--quiet', '-c', 'SHA256SUMS'], cwd=database, check=True)
    root = Path('/opt/rhi/backups/readable') / source.name.removeprefix('delta-')
    root.mkdir(parents=True, mode=0o700)  # Fail closed on an existing package.
    csvdir, photos, recovery = [root / name for name in ('Data CSV', 'Foto & Dokumen', 'Backup Pemulihan')]
    for directory in (csvdir, photos, recovery):
        directory.mkdir(mode=0o700)
    work = Path('/opt/rhi/migration') / ('readable-' + root.name)
    work.mkdir(mode=0o700)
    known_secrets = []
    for envfile in (Path('/opt/rhi/migration/runtime.env'), Path('/opt/rhi/supabase/.env')):
        if envfile.exists():
            for line in envfile.read_text().splitlines():
                if '=' in line and not line.startswith('#'):
                    key, value = line.split('=', 1)
                    value = value.strip().strip('\"\'')
                    if SECRET_NAME.search(key) and len(value) >= 12:
                        known_secrets.append(value)
    known_secrets.sort(key=len, reverse=True)
    conn = delta.connection_target(admin=True, database=report['database'])
    conn.set_session(isolation_level='REPEATABLE READ', readonly=True)
    with conn.cursor() as cur:
        cur.execute("SET LOCAL timezone='UTC'; SET LOCAL DateStyle='ISO, YMD'; SET LOCAL statement_timeout='180s'")
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        tables = [r[0] for r in cur.fetchall()]
        cur.execute('SELECT id::text,bucket_id,name,version,metadata->>\'size\' FROM storage.objects ORDER BY id')
        storage_rows = cur.fetchall()
    objects = json.loads((source / 'storage-objects.json').read_text())
    assert sorted((o['id'], o['bucket_id'], o['name'], o['version'], str(o['metadata']['size']))
                  for o in objects) == storage_rows, 'DB and files must be from the same snapshot'
    manifest = {'source_snapshot': source.name, 'database_backup': database.name,
                'created_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'offsite_uploaded': False, 'tables': [], 'excluded_csv_tables': EXCLUDED,
                'storage_objects': len(objects), 'storage_bytes': 0, 'csv_verified': False}
    csv.field_size_limit(100_000_000)
    for table in tables:
        with conn.cursor() as cur:
            cur.execute(sql.SQL('SELECT count(*) FROM {}').format(sql.Identifier('public', table)))
            expected = cur.fetchone()[0]
        if table in EXCLUDED:
            manifest['tables'].append({'table': table, 'rows': expected, 'csv': False, 'files': []})
            continue
        columns, keys = delta.metadata(conn, 'public', table)
        names = [c[0] for c in columns]
        casts = sql.SQL(',').join(sql.SQL('{}::text').format(sql.Identifier(c)) for c in names)
        query = sql.SQL('SELECT {} FROM {}').format(casts, sql.Identifier('public', table))
        if keys:
            query += sql.SQL(' ORDER BY {}').format(sql.SQL(',').join(map(sql.Identifier, keys)))
        processed, redacted, escaped, long_cells, parts = 0, 0, 0, 0, []
        stream = None
        try:
            with conn.cursor(name='csv_' + table) as cur:
                cur.itersize = 2000
                cur.execute(query)
                # One CSV even when the table has zero rows.
                def start_part():
                    path = csvdir / (table + ('_%03d' % (len(parts) + 1)) + '.csv')
                    output = path.open('x', encoding='utf-8-sig', newline='')
                    writer = csv.writer(output)
                    writer.writerow(names)
                    parts.append({'file': path.name, 'rows': 0, 'columns': len(names)})
                    return output, writer
                stream, writer = start_part()
                for row in cur:
                    if parts[-1]['rows'] >= 20000:
                        stream.close()
                        stream, writer = start_part()
                    result = []
                    for col, value in zip(names, row):
                        if value is None:
                            result.append('')
                            continue
                        original = value
                        if SECRET_NAME.search(col):
                            value = '[TERLINDUNGI: lihat backup pemulihan]'
                        else:
                            value = JSON_SECRET.sub(r'\1"[TERLINDUNGI]"', value)
                            for secret in known_secrets:
                                value = value.replace(secret, '[TERLINDUNGI]')
                        redacted += int(value != original)
                        if len(value) > 40000:
                            detail = Path('Detail Panjang') / table / f'{processed + 1}-{col}.txt'
                            (csvdir / detail).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                            (csvdir / detail).write_text(value, encoding='utf-8')
                            value = 'Lihat file: ' + str(detail)
                            long_cells += 1
                        if value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n')):
                            # A reading copy must never execute user-supplied spreadsheet formulas.
                            value = "'" + value
                            escaped += 1
                        result.append(value)
                    writer.writerow(result)
                    processed += 1
                    parts[-1]['rows'] += 1
        finally:
            if stream:
                stream.close()
        assert processed == expected
        for part in parts:
            path = csvdir / part['file']
            with path.open(encoding='utf-8-sig', newline='') as stream:
                reader = csv.reader(stream)
                assert next(reader) == names
                count = 0
                for row in reader:
                    assert len(row) == len(names)
                    assert not any(s.lstrip().startswith(('=', '+', '-', '@')) for s in row)
                    count += 1
                assert count == part['rows']
            part['sha256'] = digest(path)
        manifest['tables'].append({'table': table, 'rows': expected, 'csv': True, 'files': parts,
                                   'protected_cells': redacted, 'formula_safe_cells': escaped,
                                   'long_cells_saved_separately': long_cells})
        print('CSV verified:', table, processed, flush=True)
    conn.close()
    manifest['csv_verified'] = True
    file_index = []
    paths_used = set()
    for obj in objects:
        blob = source / 'storage-files' / obj['id']
        assert blob.resolve().parent == source / 'storage-files' and not blob.is_symlink()
        receipt = json.loads(blob.with_name(blob.name + '.json').read_text())
        assert receipt['source_version'] == obj['version']
        assert blob.stat().st_size == int(obj['metadata']['size'])
        assert digest(blob) == receipt['sha256']
        relative = Path(component(obj['bucket_id']), *map(component, obj['name'].split('/')))
        if str(relative).casefold() in paths_used:
            relative = relative.with_name(relative.stem + '~' + obj['id'] + relative.suffix)
        assert str(relative).casefold() not in paths_used
        paths_used.add(str(relative).casefold())
        target = photos / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        assert target.resolve().is_relative_to(photos)
        os.link(blob, target)  # Immutable local snapshot, no additional 22 GB copy.
        assert target.stat().st_ino == blob.stat().st_ino
        file_index.append({'id': obj['id'], 'bucket': obj['bucket_id'], 'original_name': obj['name'],
                           'file': str(relative), 'version': obj['version'], 'bytes': blob.stat().st_size,
                           'sha256': receipt['sha256']})
        manifest['storage_bytes'] += blob.stat().st_size
    write_json(root / 'Daftar Foto dan Dokumen.json', file_index)
    write_json(root / 'Daftar Data.json', manifest)
    for filename in ('storage-objects.json', 'storage-buckets.json'):
        shutil.copyfile(source / filename, work / filename)
    # All technical fields, Auth accounts, KV values and original precision remain
    # in the encrypted archive. Photos are deliberately excluded to avoid doubling
    # the user's off-site storage usage.
    password = Path('/opt/rhi/migration/restic.password')
    assert password.is_file() and password.stat().st_mode & 0o077 == 0
    repository = recovery / 'restic'
    env = {**os.environ, 'RESTIC_REPOSITORY': str(repository), 'RESTIC_PASSWORD_FILE': str(password)}
    def restic(arguments, name):
        with (work / name).open('w') as log:
            subprocess.run(['restic', *arguments], env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    restic(['init'], 'init.log')
    restic(['backup', '--json', '--tag', 'readable-backup-recovery', str(database),
            str(work / 'storage-objects.json'), str(work / 'storage-buckets.json')], 'backup.jsonl')
    summary = next(row for row in reversed([json.loads(s) for s in (work / 'backup.jsonl').read_text().splitlines()
                                           if s.startswith('{')]) if row.get('message_type') == 'summary')
    restic(['check', '--read-data'], 'check.log')
    restored = work / 'restored'
    restic(['restore', summary['snapshot_id'], '--target', str(restored)], 'restore.log')
    originals = [p for p in database.iterdir() if p.is_file()] + [work / 'storage-objects.json', work / 'storage-buckets.json']
    for original in originals:
        assert digest(original) == digest(restored / original.relative_to('/'))
    shutil.rmtree(restored)
    manifest['recovery'] = {'repository': 'Backup Pemulihan/restic', 'snapshot_id': summary['snapshot_id'],
                            'full_read_verified': True, 'all_restored_files_verified': True}
    manifest['storage_files_verified'] = True
    manifest['ready_for_index'] = True
    write_json(root / 'Daftar Data.json', manifest)
    (root / 'BACA DULU.txt').write_text(
        'BACKUP POLESHEADLAMP\n\n'
        'Salinan bertanggal ' + source.name.removeprefix('delta-') + '. Aplikasi asal tetap berjalan.\n'
        'Ini bukan data terbaru setelah waktu snapshot dan belum berarti migrasi selesai.\n\n'
        'Data CSV: tabel operasional, maksimal 20.000 baris per file. Buka file yang diperlukan\n'
        'melalui Google Sheets > File > Impor. Matikan konversi teks menjadi angka, tanggal,\n'
        'dan formula agar ID panjang dan nol di awal nomor telepon tetap utuh.\n'
        'UTF-8, pemisah koma, baris pertama nama kolom. Waktu database menggunakan UTC.\n'
        'NULL ditampilkan kosong. Teks yang dapat terbaca sebagai formula diawali apostrof.\n'
        'Nilai sangat panjang ada di Detail Panjang, dengan rujukan pada sel CSV.\n'
        'Kredensial disamarkan. Tabel KV campuran dan status penjadwal ada di backup pemulihan.\n'
        'Jangan gunakan CSV sebagai pengganti pemulihan database lengkap.\n\n'
        'Foto & Dokumen: file asli per bucket dan folder. Daftar Foto dan Dokumen.json\n'
        'memetakan nama file asli, ID, versi, ukuran dan SHA256. Beberapa karakter nama\n'
        'dikodekan agar aman di berbagai sistem. Isi file tidak diubah.\n\n'
        'Backup Pemulihan: arsip Restic terenkripsi berisi database lengkap, akun, peran,\n'
        'konfigurasi, fungsi backend dan metadata Storage. Foto tidak digandakan di arsip ini.\n'
        'Pemulihan penuh membutuhkan ketiga folder dan kunci Restic yang disimpan terpisah.\n'
        'Jangan membagikan folder ini secara publik.\n', encoding='utf-8')
    print(json.dumps({'package': str(root), 'csv_tables': sum(t['csv'] for t in manifest['tables']),
                      'csv_files': sum(len(t['files']) for t in manifest['tables']),
                      'storage_objects': len(objects), 'storage_bytes': manifest['storage_bytes'],
                      'recovery_verified': True, 'offsite_uploaded': False}), flush=True)


if __name__ == '__main__':
    main()
