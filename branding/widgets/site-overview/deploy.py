#!/usr/bin/env python3
"""
Deploy site-overview widget to ThingsBoard CE.

Usage:
    python3 deploy.py --create   # First-time creation
    python3 deploy.py            # Update existing
"""

import os
import sys
import json
import requests

# ── Config ─────────────────────────────────────────────────────

TB_URL = os.environ.get('TB_URL', 'http://46.225.54.21:8080')
TB_USER = os.environ.get('TB_USER', 'support@lumosoft.io')
TB_PASS = os.environ.get('TB_PASS', 'tenant')

WIDGET_BUNDLE_ID = '32a536f0-075c-11f1-9f20-c3880cf3b963'
WIDGET_NAME = 'Site Overview'
WIDGET_FQN = 'site_overview'

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Helpers ────────────────────────────────────────────────────

def read_file(name):
    path = os.path.join(SCRIPT_DIR, name)
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def tb_login():
    r = requests.post(f'{TB_URL}/api/auth/login',
                       json={'username': TB_USER, 'password': TB_PASS})
    r.raise_for_status()
    return r.json()['token']

def tb_get(token, path):
    r = requests.get(f'{TB_URL}/api{path}',
                     headers={'X-Authorization': f'Bearer {token}'})
    r.raise_for_status()
    return r.json()

def tb_post(token, path, body):
    r = requests.post(f'{TB_URL}/api{path}',
                      headers={'X-Authorization': f'Bearer {token}',
                               'Content-Type': 'application/json'},
                      json=body)
    r.raise_for_status()
    return r.json()

# ── Find existing widget type ──────────────────────────────────

def find_widget_type(token):
    """Find widget type by name/fqn in the SignConnect bundle."""
    try:
        result = tb_get(token, f'/widgetTypesInfos?widgetsBundleId={WIDGET_BUNDLE_ID}&pageSize=50&page=0')
        if isinstance(result, dict) and 'data' in result:
            for wt in result['data']:
                if wt.get('name') == WIDGET_NAME or wt.get('fqn') == WIDGET_FQN:
                    wt_id = wt.get('id', {}).get('id')
                    if wt_id:
                        return tb_get(token, f'/widgetType/{wt_id}')
    except Exception as e:
        print(f'  Search failed: {e}')
    return None

# ── Build descriptor ──────────────────────────────────────────

def build_descriptor():
    return {
        'type': 'static',
        'sizeX': 24,
        'sizeY': 12,
        'resources': [],
        'templateHtml': read_file('template.html'),
        'templateCss': read_file('template.css'),
        'controllerScript': read_file('controller.js'),
        'settingsSchema': read_file('settings-schema.json'),
        'dataKeySettingsSchema': '{}',
        'defaultConfig': json.dumps({
            'datasources': [],
            'settings': {
                'siteAssetId': '',
                'pollInterval': 15000,
                'autoRedirectSingleDevice': False
            }
        })
    }

# ── Deploy ─────────────────────────────────────────────────────

def deploy(create=False):
    print(f'Logging in to {TB_URL}...')
    token = tb_login()
    print('Logged in')

    descriptor = build_descriptor()

    if create:
        print(f'Creating new widget type: {WIDGET_NAME}')
        widget_type = {
            'name': WIDGET_NAME,
            'fqn': WIDGET_FQN,
            'deprecated': False,
            'scada': False,
            'descriptor': descriptor
        }
        result = tb_post(token, f'/widgetType?widgetsBundleId={WIDGET_BUNDLE_ID}', widget_type)
        wt_id = result.get('id', {}).get('id', 'unknown')
        print(f'Created widget type: {wt_id}')
        return

    # Update existing
    print(f'Finding widget type: {WIDGET_NAME}...')
    existing = find_widget_type(token)

    if not existing:
        print(f'Widget type "{WIDGET_NAME}" not found. Run: python3 deploy.py --create')
        sys.exit(1)

    wt_id = existing.get('id', {}).get('id')
    print(f'Updating widget type: {wt_id}')

    existing['descriptor'] = descriptor
    result = tb_post(token, '/widgetType', existing)
    print(f'Widget deployed: {WIDGET_NAME} ({wt_id})')

# ── Main ───────────────────────────────────────────────────────

if __name__ == '__main__':
    create_mode = '--create' in sys.argv
    try:
        deploy(create=create_mode)
    except requests.exceptions.HTTPError as e:
        print(f'HTTP Error: {e.response.status_code} - {e.response.text}')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        sys.exit(1)
