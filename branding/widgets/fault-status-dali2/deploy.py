#!/usr/bin/env python3
"""
Deploy Fault Status DALI2 widget to ThingsBoard CE — SignConnect bundle.
Idempotent: safe to re-run.

Usage:
  cd /opt/thingsboard/branding/widgets/fault-status-dali2
  python3 deploy.py
  python3 deploy.py --device-id <DEVICE_ID>
"""

import argparse
import json
import os
import sys
import requests

# ── Config ──────────────────────────────────────
TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USER = os.getenv("TB_USER", "support@lumosoft.io")
TB_PASS = os.getenv("TB_PASS", "tenant")
BUNDLE_NAME = "SignConnect"
WIDGET_FQN = "fault_status_dali2"
WIDGET_NAME = "Fault Status DALI2"
WIDGET_DESC = "DALI2 status flags (8 indicators) + tilt for SignConnect Standard"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Auth ────────────────────────────────────────
def get_token():
    resp = requests.post(f"{TB_URL}/api/auth/login",
                         json={"username": TB_USER, "password": TB_PASS})
    resp.raise_for_status()
    return resp.json()["token"]

# ── Bundle ──────────────────────────────────────
def find_or_create_bundle(headers):
    resp = requests.get(f"{TB_URL}/api/widgetsBundles", headers=headers)
    resp.raise_for_status()
    for b in resp.json():
        if b.get("title") == BUNDLE_NAME or b.get("alias") == BUNDLE_NAME.lower().replace(" ", "_"):
            print(f"  ✓ Found bundle '{BUNDLE_NAME}' → {b['id']['id']}")
            return b["id"]["id"]
    # Create
    payload = {"title": BUNDLE_NAME}
    resp = requests.post(f"{TB_URL}/api/widgetsBundle", headers=headers, json=payload)
    resp.raise_for_status()
    bid = resp.json()["id"]["id"]
    print(f"  ✓ Created bundle '{BUNDLE_NAME}' → {bid}")
    return bid

# ── Widget Type ─────────────────────────────────
def read_file(name):
    path = os.path.join(SCRIPT_DIR, name)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def build_descriptor(device_id=None):
    html = read_file("template.html")
    css = read_file("template.css")
    js = read_file("controller.js")
    settings_schema = json.loads(read_file("settings-schema.json"))

    settings = {}
    if device_id:
        settings["deviceId"] = device_id

    default_config = {
        "datasources": [],
        "settings": settings,
        "title": WIDGET_NAME,
        "showTitle": False,
        "sizeX": 24,
        "sizeY": 5
    }

    descriptor = {
        "type": "static",
        "sizeX": 24,
        "sizeY": 5,
        "resources": [],
        "templateHtml": html,
        "templateCss": css,
        "controllerScript": js,
        "settingsSchema": json.dumps(settings_schema.get("schema", {})),
        "dataKeySettingsSchema": "{}",
        "defaultConfig": json.dumps(default_config)
    }
    return descriptor

def find_existing_widget(headers, bundle_id):
    resp = requests.get(f"{TB_URL}/api/widgetTypes?bundleAlias=&widgetsBundleId={bundle_id}",
                        headers=headers)
    if resp.status_code == 200:
        widgets = resp.json()
        for w in widgets:
            if w.get("fqn") == WIDGET_FQN or w.get("name") == WIDGET_NAME:
                return w
    # Also try the other endpoint
    resp2 = requests.get(f"{TB_URL}/api/widgetTypesInfos?widgetsBundleId={bundle_id}&pageSize=100&page=0",
                         headers=headers)
    if resp2.status_code == 200:
        data = resp2.json()
        items = data.get("data", data) if isinstance(data, dict) else data
        for w in items:
            if w.get("fqn") == WIDGET_FQN or w.get("name") == WIDGET_NAME:
                return w
    return None

def deploy_widget(headers, bundle_id, device_id=None):
    descriptor = build_descriptor(device_id)
    existing = find_existing_widget(headers, bundle_id)

    payload = {
        "bundleAlias": None,
        "alias": WIDGET_FQN,
        "fqn": WIDGET_FQN,
        "name": WIDGET_NAME,
        "descriptor": descriptor,
        "deprecated": False
    }

    if existing:
        # Update
        payload["id"] = existing["id"]
        if "createdTime" in existing:
            payload["createdTime"] = existing["createdTime"]
        payload["tenantId"] = existing.get("tenantId")
        print(f"  ↻ Updating existing widget '{WIDGET_NAME}'...")
    else:
        print(f"  + Creating new widget '{WIDGET_NAME}'...")

    # Link to bundle
    resp = requests.post(
        f"{TB_URL}/api/widgetType?widgetsBundleId={bundle_id}",
        headers=headers,
        json=payload
    )
    resp.raise_for_status()
    wid = resp.json()["id"]["id"]
    print(f"  ✓ Widget deployed → {wid}")
    return wid

# ── Main ────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Deploy Fault Status DALI2 widget")
    parser.add_argument("--device-id", default=None, help="Device ID to embed in settings")
    args = parser.parse_args()

    print("═" * 50)
    print(f"  Deploying: {WIDGET_NAME}")
    print(f"  Target:    {TB_URL}")
    print("═" * 50)

    token = get_token()
    headers = {
        "Content-Type": "application/json",
        "X-Authorization": f"Bearer {token}"
    }

    bundle_id = find_or_create_bundle(headers)
    widget_id = deploy_widget(headers, bundle_id, args.device_id)

    print("═" * 50)
    print(f"  ✅ Done! Widget ID: {widget_id}")
    print(f"  Bundle: {BUNDLE_NAME}")
    print(f"  FQN: tenant.{WIDGET_FQN}")
    if args.device_id:
        print(f"  Device ID: {args.device_id}")
    print("═" * 50)

if __name__ == "__main__":
    main()
