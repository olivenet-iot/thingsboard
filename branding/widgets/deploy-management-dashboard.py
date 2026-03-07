#!/usr/bin/env python3
"""
Deploy SignConnect Management Dashboard with 2 states (Phase A):
  - default: management_nav_tree (5x24 left) + management_home (19x24 right)
  - onboarding: onboarding_wizard (24x24 full width)

Creates or updates the dashboard. Idempotent.

Usage:
    python3 deploy-management-dashboard.py
    python3 deploy-management-dashboard.py --create   # Force create new dashboard
"""

import json
import os
import sys
import uuid
import requests

# -- Config -----------------------------------------------------------------

TB_URL = os.environ.get('TB_URL', 'http://46.225.54.21:8080')
TB_USER = os.environ.get('TB_USER', 'support@lumosoft.io')
TB_PASS = os.environ.get('TB_PASS', 'tenant')

DASHBOARD_TITLE = 'SignConnect Management'
WIDGET_BUNDLE_ID = '32a536f0-075c-11f1-9f20-c3880cf3b963'

# Widget FQNs
NAV_TREE_FQN = 'tenant.management_nav_tree'
HOME_FQN = 'tenant.management_home'
WIZARD_FQN = 'tenant.onboarding_wizard'

# -- Helpers ----------------------------------------------------------------

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


def new_uuid():
    return str(uuid.uuid4())


# -- Find widget types by FQN -----------------------------------------------

def find_widget_types(token):
    """Find all widget types in SignConnect bundle, return fqn->type map."""
    types = {}

    # Primary: use paginated API
    try:
        result = tb_get(token, f'/widgetTypesInfos?widgetsBundleId={WIDGET_BUNDLE_ID}&pageSize=100&page=0')
        items = result.get('data', result) if isinstance(result, dict) else result
        for wt in items:
            fqn = wt.get('fqn', '')
            if fqn:
                types[fqn] = {
                    'id': wt.get('id', {}).get('id', ''),
                    'name': wt.get('name', ''),
                    'fqn': fqn
                }
    except Exception:
        pass

    # Fallback: use FQN list + direct lookups for any missing required FQNs
    required = [NAV_TREE_FQN, HOME_FQN, WIZARD_FQN]
    missing = [f for f in required if f not in types]
    if missing:
        try:
            fqn_list = tb_get(token, f'/widgetTypeFqns?widgetsBundleId={WIDGET_BUNDLE_ID}')
            for fqn in fqn_list:
                if fqn in missing and fqn not in types:
                    try:
                        wt = tb_get(token, f'/widgetType?fqn={fqn}')
                        types[fqn] = {
                            'id': wt.get('id', {}).get('id', ''),
                            'name': wt.get('name', ''),
                            'fqn': fqn
                        }
                    except Exception:
                        pass
        except Exception:
            pass

    return types


# -- Find or create dashboard -----------------------------------------------

def find_dashboard(token):
    """Find dashboard by title."""
    result = tb_get(token, '/tenant/dashboards?pageSize=100&page=0&sortProperty=title&sortOrder=ASC')
    items = result.get('data', []) if isinstance(result, dict) else result
    for d in items:
        if d.get('title') == DASHBOARD_TITLE:
            dashboard_id = d.get('id', {}).get('id')
            if dashboard_id:
                return tb_get(token, f'/dashboard/{dashboard_id}')
    return None


# -- Build dashboard JSON ---------------------------------------------------

def build_widget_config(widget_uuid, widget_fqn, widget_types, col, row, size_x, size_y, title, settings=None):
    """Build a widget instance config for the dashboard."""
    wt = widget_types.get(widget_fqn)
    if not wt:
        print(f'  WARNING: Widget type {widget_fqn} not found in bundle!')
        return None, None

    # typeFullFqn is just the widget FQN (not bundleAlias.fqn)
    type_full_fqn = widget_fqn

    widget_config = {
        'isSystemType': True,
        'bundleAlias': 'signconnect',
        'typeAlias': widget_fqn,
        'type': 'static',
        'title': title,
        'sizeX': size_x,
        'sizeY': size_y,
        'config': {
            'datasources': [],
            'showTitle': False,
            'backgroundColor': 'transparent',
            'padding': '0',
            'settings': settings or {},
            'title': title,
            'dropShadow': False,
            'enableFullscreen': False,
            'displayTimewindow': False
        },
        'row': row,
        'col': col,
        'id': widget_uuid,
        'typeFullFqn': type_full_fqn
    }

    layout_widget = {
        'sizeX': size_x,
        'sizeY': size_y,
        'mobileHeight': None,
        'desktopHide': False,
        'mobileHide': False,
        'row': row,
        'col': col
    }

    return widget_config, layout_widget


def build_dashboard(widget_types):
    """Build complete dashboard JSON with 2 states."""

    # Generate unique widget UUIDs for each state
    default_nav_uuid = new_uuid()
    default_home_uuid = new_uuid()
    onboarding_wizard_uuid = new_uuid()

    # Entity alias (stateEntity — required for entity state controller)
    alias_id = new_uuid()
    entity_aliases = {
        alias_id: {
            'id': alias_id,
            'alias': 'Current Entity',
            'filter': {
                'type': 'stateEntity',
                'resolveMultiple': False
            }
        }
    }

    # Build widget configs for default state
    nav_config, nav_layout = build_widget_config(
        default_nav_uuid, NAV_TREE_FQN, widget_types,
        col=0, row=0, size_x=5, size_y=24,
        title='Management Nav Tree',
        settings={
            'brandName': 'SIGNCONNECT',
            'showSearch': True,
            'showStatusIndicators': True,
            'showFooterSummary': True,
            'onlineThresholdMinutes': 10,
            'pollIntervalSeconds': 60
        }
    )

    home_config, home_layout = build_widget_config(
        default_home_uuid, HOME_FQN, widget_types,
        col=5, row=0, size_x=19, size_y=24,
        title='Management Home'
    )

    # Build widget config for onboarding state
    wizard_config, wizard_layout = build_widget_config(
        onboarding_wizard_uuid, WIZARD_FQN, widget_types,
        col=0, row=0, size_x=24, size_y=24,
        title='Onboarding Wizard'
    )

    # Collect all configs
    all_widgets = {}
    default_layout_widgets = {}
    onboarding_layout_widgets = {}

    if nav_config:
        all_widgets[default_nav_uuid] = nav_config
        default_layout_widgets[default_nav_uuid] = nav_layout
    if home_config:
        all_widgets[default_home_uuid] = home_config
        default_layout_widgets[default_home_uuid] = home_layout
    if wizard_config:
        all_widgets[onboarding_wizard_uuid] = wizard_config
        onboarding_layout_widgets[onboarding_wizard_uuid] = wizard_layout

    # Dashboard configuration
    dashboard_config = {
        'widgets': all_widgets,
        'states': {
            'default': {
                'name': 'Home',
                'root': True,
                'layouts': {
                    'main': {
                        'widgets': default_layout_widgets,
                        'gridSettings': {
                            'backgroundColor': '#f0f0f0',
                            'columns': 24,
                            'margin': 0,
                            'outerMargin': False,
                            'backgroundSizeMode': '100%'
                        }
                    }
                }
            },
            'onboarding': {
                'name': 'New Customer',
                'root': False,
                'layouts': {
                    'main': {
                        'widgets': onboarding_layout_widgets,
                        'gridSettings': {
                            'backgroundColor': '#f0f0f0',
                            'columns': 24,
                            'margin': 0,
                            'outerMargin': False,
                            'backgroundSizeMode': '100%'
                        }
                    }
                }
            }
        },
        'entityAliases': entity_aliases,
        'timewindow': {
            'displayValue': '',
            'selectedTab': 0,
            'realtime': {
                'realtimeType': 0,
                'interval': 1000,
                'timewindowMs': 60000
            },
            'history': {
                'historyType': 0,
                'interval': 1000,
                'timewindowMs': 60000
            },
            'aggregation': {
                'type': 'NONE'
            }
        },
        'settings': {
            'stateControllerId': 'entity',
            'showTitle': False,
            'showDashboardsSelect': False,
            'showEntitiesSelect': False,
            'showDashboardTimewindow': False,
            'hideToolbar': True,
            'showDashboardLogo': True,
            'dashboardLogoUrl': 'tb-image;/api/images/tenant/logo_title_white.svg',
            'toolbarAlwaysOpen': False
        }
    }

    return dashboard_config


# -- Deploy -----------------------------------------------------------------

def deploy(force_create=False):
    print('=' * 60)
    print(f'  SignConnect Management Dashboard — Phase A Deploy')
    print(f'  Target: {TB_URL}')
    print('=' * 60)

    token = tb_login()
    print('  Logged in')

    # Find widget types
    print('  Finding widget types...')
    widget_types = find_widget_types(token)

    found = []
    for fqn in [NAV_TREE_FQN, HOME_FQN, WIZARD_FQN]:
        if fqn in widget_types:
            found.append(fqn)
            print(f'    {fqn} -> {widget_types[fqn]["id"]}')
        else:
            print(f'    {fqn} -> NOT FOUND (deploy widget first!)')

    if len(found) < 3:
        missing = [f for f in [NAV_TREE_FQN, HOME_FQN, WIZARD_FQN] if f not in widget_types]
        print(f'\n  Missing widget types: {missing}')
        print('  Deploy them first:')
        for m in missing:
            short = m.replace('tenant.', '')
            dirname = short.replace('_', '-')
            print(f'    cd branding/widgets/{dirname} && python3 deploy.py --create')
        sys.exit(1)

    # Build dashboard config
    print('  Building dashboard configuration...')
    config = build_dashboard(widget_types)

    # Find or create dashboard
    existing = None if force_create else find_dashboard(token)

    if existing:
        print(f'  Updating existing dashboard: {existing["id"]["id"]}')
        existing['configuration'] = config
        result = tb_post(token, '/dashboard', existing)
    else:
        print('  Creating new dashboard...')
        dashboard = {
            'title': DASHBOARD_TITLE,
            'configuration': config
        }
        result = tb_post(token, '/dashboard', dashboard)

    dashboard_id = result.get('id', {}).get('id', 'unknown')

    print('=' * 60)
    print(f'  Dashboard deployed!')
    print(f'  ID: {dashboard_id}')
    print(f'  URL: {TB_URL}/dashboard/{dashboard_id}')
    print(f'  States: default (nav-tree + home), onboarding (wizard)')
    print('=' * 60)


if __name__ == '__main__':
    force_create = '--create' in sys.argv
    try:
        deploy(force_create=force_create)
    except requests.exceptions.HTTPError as e:
        print(f'HTTP Error: {e.response.status_code} - {e.response.text[:500]}')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
