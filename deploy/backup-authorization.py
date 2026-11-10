"""Evaluate operator-observed Drive authorization without reading credentials."""
import datetime
import json


def authorization_status(root, now):
    production = root / 'google-drive-production-authorization.json'
    testing = root / 'google-drive-testing-authorization.json'
    if production.exists():
        auth = json.loads(production.read_text())
        if (auth.get('production_reauthorized') is True and auth.get('scope') == 'drive.file'
                and auth.get('project_id') == 'modified-legacy-513908-b4'):
            return {'valid': True, 'durable': True, 'mode': 'production', 'expires_at': None, 'hours_remaining': None}
    if testing.exists():
        auth = json.loads(testing.read_text())
        assert auth.get('owner_accepted_seven_day_limit') is True
        assert auth.get('scope') == 'drive.file' and auth.get('project_id') == 'modified-legacy-513908-b4'
        issued = datetime.datetime.fromisoformat(auth['received_at'])
        expiry = datetime.datetime.fromisoformat(auth['expires_at'])
        assert issued.tzinfo and expiry.tzinfo and 0 < (expiry - issued).total_seconds() <= 604800
        hours = (expiry - now).total_seconds() / 3600
        return {'valid': issued <= now < expiry, 'durable': False, 'mode': 'testing',
                'expires_at': expiry.isoformat(), 'hours_remaining': round(hours, 2)}
    return {'valid': False, 'durable': False, 'mode': 'unconfirmed', 'expires_at': None, 'hours_remaining': None}
