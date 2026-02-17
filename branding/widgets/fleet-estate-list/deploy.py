#!/usr/bin/env python3
"""
Deploy Fleet Estate List widget to ThingsBoard SignConnect bundle.
Idempotent: safe to re-run.

Usage:
  cd /opt/thingsboard/branding/widgets/fleet-estate-list
  python3 deploy.py
"""

import json
import os
import sys
import requests

# ── Config ──────────────────────────────────────
TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USER = os.getenv("TB_USER", "support@lumosoft.io")
TB_PASS = os.getenv("TB_PASS", "tenant")
BUNDLE_NAME = "SignConnect"
WIDGET_FQN = "fleet_estate_list"
WIDGET_NAME = "Fleet Estate List"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def get_token():
    resp = requests.post(f"{TB_URL}/api/auth/login",
                         json={"username": TB_USER, "password": TB_PASS})
    resp.raise_for_status()
    return resp.json()["token"]


def find_or_create_bundle(hdrs):
    resp = requests.get(f"{TB_URL}/api/widgetsBundles", headers=hdrs)
    resp.raise_for_status()
    for b in resp.json():
        if b.get("title") == BUNDLE_NAME:
            print(f"  ✓ Found bundle '{BUNDLE_NAME}' → {b['id']['id']}")
            return b["id"]["id"]
    payload = {"title": BUNDLE_NAME}
    resp = requests.post(f"{TB_URL}/api/widgetsBundle", headers=hdrs, json=payload)
    resp.raise_for_status()
    bid = resp.json()["id"]["id"]
    print(f"  ✓ Created bundle '{BUNDLE_NAME}' → {bid}")
    return bid


def read_file(name):
    path = os.path.join(SCRIPT_DIR, name)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def build_descriptor():
    default_config = json.dumps({
        "datasources": [{
            "type": "entity",
            "dataKeys": [
                {"name": "client_name", "type": "attribute", "label": "client_name", "settings": {}, "funcBody": None, "_hash": 0.1}
            ]
        }],
        "timewindow": {"realtime": {"timewindowMs": 600000}},
        "showTitle": False,
        "backgroundColor": "transparent",
        "padding": "0",
        "settings": {"onlineThresholdMinutes": 10},
        "title": WIDGET_NAME,
        "dropShadow": False,
        "enableFullscreen": False,
        "displayTimewindow": False
    })

    return {
        "type": "latest",
        "sizeX": 24,
        "sizeY": 8,
        "resources": [],
        "templateHtml": read_file("template.html"),
        "templateCss": read_file("template.css"),
        "controllerScript": read_file("controller.js"),
        "settingsSchema": read_file("settings-schema.json"),
        "dataKeySettingsSchema": "{}",
        "defaultConfig": default_config
    }


def find_existing_widget(hdrs, bundle_id):
    resp = requests.get(
        f"{TB_URL}/api/widgetTypesInfos?widgetsBundleId={bundle_id}"
        f"&pageSize=100&page=0&sortOrder=ASC&sortProperty=name",
        headers=hdrs,
    )
    if resp.status_code != 200:
        resp = requests.get(
            f"{TB_URL}/api/widgetTypes?widgetsBundleId={bundle_id}",
            headers=hdrs,
        )
    if resp.status_code != 200:
        return None

    data = resp.json()
    items = data.get("data", data) if isinstance(data, dict) else data

    for w in items:
        if w.get("name") == WIDGET_NAME or w.get("fqn") == WIDGET_FQN:
            wt_id = w.get("id", {}).get("id")
            if wt_id and "descriptor" not in w:
                r2 = requests.get(f"{TB_URL}/api/widgetType/{wt_id}", headers=hdrs)
                if r2.status_code == 200:
                    return r2.json()
            return w
    return None


def deploy_widget(hdrs, bundle_id):
    descriptor = build_descriptor()
    existing = find_existing_widget(hdrs, bundle_id)

    payload = {
        "bundleAlias": None,
        "alias": WIDGET_FQN,
        "fqn": WIDGET_FQN,
        "name": WIDGET_NAME,
        "descriptor": descriptor,
        "deprecated": False
    }

    if existing:
        payload["id"] = existing["id"]
        if "createdTime" in existing:
            payload["createdTime"] = existing["createdTime"]
        payload["tenantId"] = existing.get("tenantId")
        print(f"  ↻ Updating existing widget '{WIDGET_NAME}'...")
    else:
        print(f"  + Creating new widget '{WIDGET_NAME}'...")

    resp = requests.post(
        f"{TB_URL}/api/widgetType?widgetsBundleId={bundle_id}",
        headers=hdrs,
        json=payload
    )
    resp.raise_for_status()
    wid = resp.json()["id"]["id"]
    print(f"  ✓ Widget deployed → {wid}")
    return wid


def main():
    print("═" * 50)
    print(f"  Deploying: {WIDGET_NAME}")
    print(f"  Target:    {TB_URL}")
    print("═" * 50)

    token = get_token()
    hdrs = {
        "Content-Type": "application/json",
        "X-Authorization": f"Bearer {token}"
    }

    bundle_id = find_or_create_bundle(hdrs)
    widget_id = deploy_widget(hdrs, bundle_id)

    print("═" * 50)
    print(f"  ✅ Done! Widget ID: {widget_id}")
    print(f"  Bundle: {BUNDLE_NAME}")
    print(f"  Type: latest")
    print(f"  Alias: All Estates (assetType=estate)")
    print(f"  Key: client_name (server attribute)")
    print(f"  Size: 24 × 8")
    print(f"  Click: → estate dashboard state")
    print("═" * 50)


if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP Error: {e}")
        if e.response is not None:
            print(f"   Response: {e.response.text[:500]}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
