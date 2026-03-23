#!/usr/bin/env python3
"""
Deploy Management Navigation Tree widget to ThingsBoard SignConnect bundle.
Idempotent: safe to re-run.

Usage:
    python3 deploy.py           # Create or update
    python3 deploy.py --create  # Force create new (same behavior)
"""

import os
import sys
import json
import requests

TB_URL = os.environ.get('TB_URL', 'https://portal.lumosoft.io')
TB_USER = os.environ.get('TB_USER', 'support@lumosoft.io')
TB_PASS = os.environ.get('TB_PASS', 'tenant')

WIDGET_BUNDLE_ID = '32a536f0-075c-11f1-9f20-c3880cf3b963'
WIDGET_NAME = 'Management Nav Tree'
WIDGET_FQN = 'tenant.management_nav_tree'

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


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


def tb_post_no_response(token, path, body):
    """POST that may return empty body (e.g., bundle link)."""
    r = requests.post(f'{TB_URL}/api{path}',
                      headers={'X-Authorization': f'Bearer {token}',
                               'Content-Type': 'application/json'},
                      json=body)
    r.raise_for_status()
    return r


def find_widget_by_fqn(token):
    """Find widget type by FQN across all bundle types."""
    # Search in the bundle
    try:
        result = tb_get(token, f'/widgetTypesInfos?widgetsBundleId={WIDGET_BUNDLE_ID}&pageSize=100&page=0')
        for wt in result.get('data', []):
            if wt.get('fqn') == WIDGET_FQN or wt.get('name') == WIDGET_NAME:
                wt_id = wt['id']['id']
                return tb_get(token, f'/widgetType/{wt_id}')
    except Exception:
        pass

    # Also try direct FQN lookup (TB 4.x)
    try:
        return tb_get(token, f'/widgetType?fqn={WIDGET_FQN}')
    except Exception:
        pass

    return None


def link_to_bundle(token):
    """Ensure widget FQN is linked to the SignConnect bundle."""
    # Get current FQNs in bundle
    current_fqns = tb_get(token, f'/widgetTypeFqns?widgetsBundleId={WIDGET_BUNDLE_ID}')
    if WIDGET_FQN not in current_fqns:
        updated = current_fqns + [WIDGET_FQN]
        tb_post_no_response(token, f'/widgetsBundle/{WIDGET_BUNDLE_ID}/widgetTypeFqns', updated)
        print(f'  Linked {WIDGET_FQN} to bundle')
    else:
        print(f'  Already in bundle')


def build_descriptor():
    return {
        'type': 'static',
        'sizeX': 5,
        'sizeY': 24,
        'resources': [],
        'templateHtml': read_file('template.html'),
        'templateCss': read_file('template.css'),
        'controllerScript': read_file('controller.js'),
        'settingsSchema': read_file('settings-schema.json'),
        'dataKeySettingsSchema': '{}',
        'defaultConfig': json.dumps({
            'datasources': [],
            'showTitle': False,
            'backgroundColor': 'transparent',
            'padding': '0',
            'settings': {
                'brandName': 'SIGNCONNECT',
                'showSearch': True,
                'showStatusIndicators': True,
                'showFooterSummary': True,
                'onlineThresholdMinutes': 10,
                'pollIntervalSeconds': 60
            },
            'title': WIDGET_NAME,
            'dropShadow': False,
            'enableFullscreen': False,
            'displayTimewindow': False
        })
    }


def deploy():
    print(f'Logging in to {TB_URL}...')
    token = tb_login()
    print('Logged in')

    descriptor = build_descriptor()

    # Find existing or create new
    existing = find_widget_by_fqn(token)

    if existing:
        wt_id = existing['id']['id']
        print(f'Updating existing widget type: {wt_id}')
        existing['descriptor'] = descriptor
        result = tb_post(token, '/widgetType', existing)
    else:
        print(f'Creating new widget type: {WIDGET_NAME}')
        widget_type = {
            'name': WIDGET_NAME,
            'fqn': WIDGET_FQN,
            'deprecated': False,
            'scada': False,
            'descriptor': descriptor
        }
        result = tb_post(token, '/widgetType', widget_type)

    wt_id = result.get('id', {}).get('id', 'unknown')
    print(f'Widget type saved: {wt_id}')

    # Link to bundle
    link_to_bundle(token)
    print(f'Done: {WIDGET_NAME} ({WIDGET_FQN})')


if __name__ == '__main__':
    try:
        deploy()
    except requests.exceptions.HTTPError as e:
        print(f'HTTP Error: {e.response.status_code} - {e.response.text}')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        sys.exit(1)
