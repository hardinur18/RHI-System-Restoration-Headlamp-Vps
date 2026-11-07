"""Pure retention policy for completed, application-owned backup snapshots."""
import datetime
import re


def retained_snapshots(stamps, daily=7, weekly=4):
    assert 1 <= daily <= 31 and 1 <= weekly <= 12
    days, weeks = {}, {}
    for stamp in sorted(set(stamps), reverse=True):
        assert re.fullmatch(r'\d{8}T\d{6}Z', stamp)
        dt = datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ')
        days.setdefault(dt.date(), stamp)
        weeks.setdefault(dt.isocalendar()[:2], stamp)
    return set(list(days.values())[:daily]) | set(list(weeks.values())[:weekly])


def relative_path(value):
    assert isinstance(value, str) and value and not value.startswith('/')
    assert all(part not in ('', '.', '..') for part in value.split('/'))
    assert not any(c in value for c in ('\n', '\r', '\\', '\x00'))
    return value
