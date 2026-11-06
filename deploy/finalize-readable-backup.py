#!/usr/bin/env python3
"""Check the reading index and seal an already verified private backup package."""
import argparse
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package')
    args = parser.parse_args()
    assert os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'srv2126686'
    os.umask(0o077)
    lock = open('/run/lock/rhi-readable-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = Path(args.package).resolve()
    assert root.parent == Path('/opt/rhi/backups/readable')
    manifest = json.loads((root / 'Daftar Data.json').read_text())
    assert manifest['csv_verified'] and manifest['storage_files_verified']
    assert manifest['recovery']['all_restored_files_verified']
    with (root / 'Data CSV/00_Daftar_Data.csv').open(encoding='utf-8-sig', newline='') as stream:
        index = list(csv.DictReader(stream))
    expected = {p['file']: p['rows'] for t in manifest['tables'] for p in t['files']}
    actual = {row['File CSV']: int(row['Jumlah baris']) for row in index if row['File CSV']}
    assert actual == expected and len(actual) == len([r for r in index if r['File CSV']])
    assert len(index) == len(expected) + len(manifest['excluded_csv_tables'])
    for table in manifest['tables']:
        for part in table['files']:
            assert digest(root / 'Data CSV' / part['file']) == part['sha256']
    photos = json.loads((root / 'Daftar Foto dan Dokumen.json').read_text())
    photo_hashes = {}
    source = Path('/opt/rhi/backups') / manifest['source_snapshot'] / 'storage-files'
    for row in photos:
        path = root / 'Foto & Dokumen' / row['file']
        assert path.is_file() and not path.is_symlink() and path.stat().st_size == row['bytes']
        assert path.stat().st_ino == (source / row['id']).stat().st_ino
        photo_hashes[str(path.relative_to(root))] = row['sha256']
    assert len(photo_hashes) == manifest['storage_objects']
    manifest['index_verified'] = True
    manifest['ready_for_upload'] = True
    (root / 'Daftar Data.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    checksums = []
    size = 0
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink(), 'No links to content outside the package'
        if not path.is_file() or path == root / 'SHA256SUMS':
            continue
        relative = str(path.relative_to(root))
        assert '\n' not in relative and '\r' not in relative and '\\' not in relative
        size += path.stat().st_size
        checksums.append(photo_hashes.get(relative) or digest(path))
        checksums[-1] += '  ' + relative
    (root / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    result = {'package': str(root), 'csv_tables': sum(t['csv'] for t in manifest['tables']),
              'csv_data_files': len(expected), 'csv_index_files': 1,
              'csv_rows': sum(t['rows'] for t in manifest['tables'] if t['csv']),
              'photos_and_documents': len(photos), 'photo_bytes': manifest['storage_bytes'],
              'package_bytes': size, 'all_recovery_files_restored_and_verified': True,
              'ready_for_upload': True, 'offsite_uploaded': False}
    report = Path('/opt/rhi/migration') / ('readable-' + root.name) / 'final-report.json'
    report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
