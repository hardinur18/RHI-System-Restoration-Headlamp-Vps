#!/usr/bin/env python3
"""Exercise retention across month/year boundaries and reject unsafe paths."""
import datetime
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('policy', Path(__file__).with_name('scheduled-backup-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class RetentionTests(unittest.TestCase):
    def test_four_weeks_plus_daily_across_year_boundary(self):
        end = datetime.datetime(2027, 1, 12, 3, 30)
        stamps = [(end - datetime.timedelta(days=i)).strftime('%Y%m%dT%H%M%SZ') for i in range(60)]
        keep = policy.retained_snapshots(stamps)
        self.assertTrue(set(stamps[:7]).issubset(keep))
        weeks = {}
        for stamp in stamps:
            dt = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ')
            weeks.setdefault(dt.isocalendar()[:2], stamp)
        self.assertTrue(set(list(weeks.values())[:4]).issubset(keep))
        self.assertLessEqual(len(keep), 11)
        self.assertNotIn(stamps[-1], keep)

    def test_latest_run_per_day_and_idempotent(self):
        stamps = ['20261107T010000Z', '20261107T020000Z', '20261106T030000Z']
        self.assertEqual(policy.retained_snapshots(stamps), {'20261107T020000Z', '20261106T030000Z'})
        self.assertEqual(policy.retained_snapshots(stamps + stamps), policy.retained_snapshots(reversed(stamps)))

    def test_empty_and_invalid_policy(self):
        self.assertEqual(policy.retained_snapshots([]), set())
        for daily, weekly in [(0, 4), (7, 0), (32, 4), (7, 13)]:
            with self.assertRaises(AssertionError): policy.retained_snapshots([], daily, weekly)
        for stamp in ['../../legacy', '20261307T020000Z', '20261107T020000Z/']:
            with self.assertRaises((AssertionError, ValueError)): policy.retained_snapshots([stamp])

    def test_drive_paths_are_literal_safe_relative_names(self):
        for name in ['Foto & Dokumen/bucket/foto (1).jpg', 'Backup Otomatis/Snapshot/20261107T020000Z/a.csv']:
            self.assertEqual(policy.relative_path(name), name)
        for name in ['', '/etc/passwd', '../file', 'a/../file', 'a//b', 'a/./b', 'a\nb', 'a\rb', 'a\\b', 'a\x00b']:
            with self.assertRaises(AssertionError): policy.relative_path(name)

    def test_modified_added_or_replaced_files_block_retention(self):
        original = [{'Path': 'Data CSV/orders.csv', 'ID': 'file-id', 'Size': 10, 'Hashes': {'md5': 'a' * 32}}]
        expected = policy.inventory_signature(original)
        for change in ['id', 'size', 'hash', 'extra']:
            changed = copy.deepcopy(original)
            if change == 'id': changed[0]['ID'] = 'replacement-id'
            if change == 'size': changed[0]['Size'] += 1
            if change == 'hash': changed[0]['Hashes']['md5'] = 'b' * 32
            if change == 'extra': changed.append({**original[0], 'Path': 'user-note.txt'})
            self.assertNotEqual(policy.inventory_signature(changed), expected)

    def test_ambiguous_or_incomplete_inventory_blocks_retention(self):
        item = {'Path': 'file.csv', 'ID': 'file-id', 'Size': 10, 'Hashes': {'md5': 'a' * 32}}
        for invalid in [[item, item], [{**item, 'Hashes': {}}], [{**item, 'ID': ''}], [{**item, 'Path': '../file'}]]:
            with self.assertRaises(AssertionError): policy.inventory_signature(invalid)


if __name__ == '__main__':
    unittest.main()
