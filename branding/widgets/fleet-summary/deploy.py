#!/usr/bin/env python3
"""
Deploy Fleet Summary Cards widget to ThingsBoard SignConnect bundle.

Usage:
    python deploy.py
    python deploy.py --url http://localhost:8080
    python deploy.py --update   # Force update existing widget
"""

import requests
import json
import sys
import os
import argparse

# --- Configuration ---
DEFAULT_TB_URL = "http://46.225.54.21:8080"
TB_USER = "support@lumosoft.io"
TB_PASS = "tenant"
BUNDLE_ID = "32a536f0-075c-11f1-9f20-c3880cf3b963"  # SignConnect bundle

WIDGET_NAME = "Fleet Summary Cards"
WIDGET_ALIAS = "fleet_summary_cards"
WIDGET_TYPE = "latest"
WIDGET_SIZE_X = 24
WIDGET_SIZE_Y = 3

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def read_file(filename):
    filepath = os.path.join(SCRIPT_DIR, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def login(base_url):
    resp = requests.post(
        f"{base_url}/api/auth/login",
        json={"username": TB_USER, "password": TB_PASS},
        headers={"Content-Type": "application/json"}
    )
    resp.raise_for_status()
    return resp.json()["token"]


def get_bundle_widgets(base_url, token):
    resp = requests.get(
        f"{base_url}/api/widgetTypesInfos?widgetsBundleId={BUNDLE_ID}",
        headers={"X-Authorization": f"Bearer {token}"}
    )
    resp.raise_for_status()
    return resp.json()


def get_widget_type(base_url, token, widget_id):
    resp = requests.get(
        f"{base_url}/api/widgetType/{widget_id}",
        headers={"X-Authorization": f"Bearer {token}"}
    )
    resp.raise_for_status()
    return resp.json()


def save_widget_type(base_url, token, widget_json):
    resp = requests.post(
        f"{base_url}/api/widgetType",
        json=widget_json,
        headers={
            "X-Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    )
    resp.raise_for_status()
    return resp.json()


def build_default_config():
    return json.dumps({
        "datasources": [
            {
                "type": "entity",
                "dataKeys": [
                    {
                        "name": "dim_value",
                        "type": "timeseries",
                        "label": "dim_value",
                        "settings": {},
                        "funcBody": None,
                        "_hash": 0.1
                    },
                    {
                        "name": "fault_overall_failure",
                        "type": "timeseries",
                        "label": "fault_overall_failure",
                        "settings": {},
                        "funcBody": None,
                        "_hash": 0.2
                    }
                ]
            }
        ],
        "timewindow": {
            "realtime": {
                "timewindowMs": 600000
            }
        },
        "showTitle": False,
        "backgroundColor": "transparent",
        "color": "rgba(0, 0, 0, 0.87)",
        "padding": "0",
        "settings": {
            "onlineThresholdMinutes": 10,
            "label": "Devices"
        },
        "title": "Fleet Summary Cards",
        "dropShadow": False,
        "enableFullscreen": False,
        "widgetStyle": {},
        "titleStyle": {},
        "showTitleIcon": False,
        "iconColor": "rgba(0, 0, 0, 0.87)",
        "iconSize": "24px",
        "titleTooltip": "",
        "displayTimewindow": False
    })


def deploy(base_url, force_update=False):
    print(f"🔌 Connecting to {base_url}")
    token = login(base_url)
    print("✅ Logged in")

    # Read widget files
    template_html = read_file("template.html")
    template_css = read_file("template.css")
    controller_js = read_file("controller.js")
    settings_schema = read_file("settings-schema.json")

    print(f"📦 Read widget files ({len(template_html)} + {len(template_css)} + {len(controller_js)} bytes)")

    # Check if widget already exists
    widgets = get_bundle_widgets(base_url, token)
    existing = None

    for w in widgets:
        if w.get("alias") == WIDGET_ALIAS or w.get("name") == WIDGET_NAME:
            existing = w
            break

    # Build descriptor
    descriptor = {
        "type": WIDGET_TYPE,
        "sizeX": WIDGET_SIZE_X,
        "sizeY": WIDGET_SIZE_Y,
        "resources": [],
        "templateHtml": template_html,
        "templateCss": template_css,
        "controllerScript": controller_js,
        "settingsSchema": settings_schema,
        "dataKeySettingsSchema": "{}",
        "defaultConfig": build_default_config()
    }

    if existing and not force_update:
        # Update existing widget
        widget_id = existing["id"]["id"]
        print(f"📝 Found existing widget: {widget_id}")

        full_widget = get_widget_type(base_url, token, widget_id)
        full_widget["descriptor"] = descriptor
        result = save_widget_type(base_url, token, full_widget)
        print(f"✅ Updated: {WIDGET_NAME}")

    elif existing and force_update:
        widget_id = existing["id"]["id"]
        full_widget = get_widget_type(base_url, token, widget_id)
        full_widget["descriptor"] = descriptor
        result = save_widget_type(base_url, token, full_widget)
        print(f"✅ Force updated: {WIDGET_NAME}")

    else:
        # Create new widget
        widget_json = {
            "name": WIDGET_NAME,
            "alias": WIDGET_ALIAS,
            "descriptor": descriptor
        }

        # Attach to bundle
        # TB CE uses different methods depending on version
        # Method 1: bundleAlias in body
        # Method 2: widgetsBundleId in body
        widget_json["id"] = None

        # Try saving with bundle reference
        try:
            # First try: save widget type and then add to bundle
            result = save_widget_type(base_url, token, widget_json)
            widget_type_id = result["id"]["id"]

            # Add to bundle
            resp = requests.post(
                f"{base_url}/api/widgetType/{widget_type_id}/bundle/{BUNDLE_ID}",
                headers={"X-Authorization": f"Bearer {token}"}
            )

            if resp.status_code >= 400:
                # Alternative: include bundle in the widget type body
                widget_json_v2 = {
                    "name": WIDGET_NAME,
                    "alias": WIDGET_ALIAS,
                    "descriptor": descriptor,
                    "widgetsBundleId": {
                        "entityType": "WIDGETS_BUNDLE",
                        "id": BUNDLE_ID
                    }
                }
                result = save_widget_type(base_url, token, widget_json_v2)

            print(f"✅ Created: {WIDGET_NAME} → {result['id']['id']}")

        except Exception as e:
            print(f"❌ Create failed: {e}")
            print("   Trying alternative method...")

            widget_json_v2 = {
                "name": WIDGET_NAME,
                "alias": WIDGET_ALIAS,
                "descriptor": descriptor,
                "widgetsBundleId": {
                    "entityType": "WIDGETS_BUNDLE",
                    "id": BUNDLE_ID
                }
            }
            result = save_widget_type(base_url, token, widget_json_v2)
            print(f"✅ Created (v2): {WIDGET_NAME} → {result['id']['id']}")

    print(f"\n📋 Widget: {WIDGET_NAME}")
    print(f"   Type: {WIDGET_TYPE}")
    print(f"   Size: {WIDGET_SIZE_X} × {WIDGET_SIZE_Y}")
    print(f"   Bundle: SignConnect ({BUNDLE_ID})")
    print(f"   Datasource keys: dim_value, fault_overall_failure")
    print(f"\n💡 Configure datasource with entity alias:")
    print(f"   HOME state  → 'All Devices' alias (deviceType filter)")
    print(f"   ESTATE state → 'Descendant Devices' alias (relationsQuery)")
    print(f"   REGION state → 'Descendant Devices' alias (relationsQuery)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy Fleet Summary Cards widget")
    parser.add_argument("--url", default=DEFAULT_TB_URL, help="ThingsBoard URL")
    parser.add_argument("--update", action="store_true", help="Force update existing")
    args = parser.parse_args()

    try:
        deploy(args.url, force_update=args.update)
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP Error: {e}")
        print(f"   Response: {e.response.text if e.response else 'N/A'}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
