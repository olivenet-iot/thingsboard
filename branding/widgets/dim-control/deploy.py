#!/usr/bin/env python3
"""Deploy Dim Control as a Widget Library widget in ThingsBoard.

Creates/updates:
  - Widget bundle "Zenopix DALI" (reuses existing bundle from scheduler)
  - Widget type "Dim Control" (static widget)

Usage:
  python3 deploy.py              # Deploy widget only
  python3 deploy.py --device-id UUID  # Set default device ID in settings
"""

import argparse
import json
import os
import sys

import requests

TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USER = os.getenv("TB_USER", "support@lumosoft.io")
TB_PASS = os.getenv("TB_PASS", "tenant")

BUNDLE_TITLE = "Zenopix DALI"
WIDGET_NAME = "Dim Control"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def read_file(name):
    path = os.path.join(SCRIPT_DIR, name)
    with open(path, "r") as f:
        return f.read()


def login():
    r = requests.post(
        f"{TB_URL}/api/auth/login",
        json={"username": TB_USER, "password": TB_PASS},
    )
    r.raise_for_status()
    return r.json()["token"]


def headers(token):
    return {
        "X-Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


# ─── Widget Bundle ────────────────────────────────────────────────────────────

def find_bundle(token):
    """Find existing 'Zenopix DALI' bundle, return it or None."""
    r = requests.get(f"{TB_URL}/api/widgetsBundles", headers=headers(token))
    r.raise_for_status()
    for b in r.json():
        if b.get("title") == BUNDLE_TITLE:
            return b
    return None


def create_bundle(token):
    """Create a new widget bundle."""
    body = {"title": BUNDLE_TITLE}
    r = requests.post(
        f"{TB_URL}/api/widgetsBundle", headers=headers(token), json=body
    )
    r.raise_for_status()
    return r.json()


# ─── Widget Type ──────────────────────────────────────────────────────────────

def find_widget_types_by_bundle_id(token, bundle_id):
    """Find widget types using bundle ID (TB 3.6+ API)."""
    r = requests.get(
        f"{TB_URL}/api/widgetTypesInfos?widgetsBundleId={bundle_id}"
        f"&pageSize=100&page=0&sortOrder=ASC&sortProperty=name",
        headers=headers(token),
    )
    if r.status_code == 200 and r.text:
        data = r.json()
        items = data.get("data", data) if isinstance(data, dict) else data
        for wt in items:
            if wt.get("name") == WIDGET_NAME:
                wt_id = wt.get("id", {}).get("id")
                if wt_id and "descriptor" not in wt:
                    r2 = requests.get(
                        f"{TB_URL}/api/widgetType/{wt_id}",
                        headers=headers(token),
                    )
                    if r2.status_code == 200:
                        return r2.json()
                return wt
    return None


def build_widget_type(template_html, template_css, controller_js,
                      settings_schema, device_id=""):
    """Build the widget type JSON payload."""
    descriptor = {
        "type": "static",
        "sizeX": 8,
        "sizeY": 10,
        "resources": [],
        "templateHtml": template_html,
        "templateCss": template_css,
        "controllerScript": controller_js,
        "settingsSchema": json.dumps(settings_schema),
        "dataKeySettingsSchema": "{}",
        "defaultConfig": json.dumps({
            "datasources": [],
            "settings": {
                "pollIntervalMs": 10000,
                "deviceId": device_id,
            },
        }),
    }
    return {
        "name": WIDGET_NAME,
        "descriptor": descriptor,
    }


def save_widget_type(token, widget_type_payload, existing=None):
    """Create or update the widget type."""
    if existing:
        widget_type_payload["id"] = existing["id"]
        if "createdTime" in existing:
            widget_type_payload["createdTime"] = existing["createdTime"]
        if "tenantId" in existing:
            widget_type_payload["tenantId"] = existing["tenantId"]
        if "fqn" in existing:
            widget_type_payload["fqn"] = existing["fqn"]

    r = requests.post(
        f"{TB_URL}/api/widgetType",
        headers=headers(token),
        json=widget_type_payload,
    )
    r.raise_for_status()
    return r.json()


def link_widget_to_bundle(token, bundle_id, widget_type_id):
    """Link a widget type to a bundle via the dedicated API."""
    r = requests.post(
        f"{TB_URL}/api/widgetsBundle/{bundle_id}/widgetTypes",
        headers=headers(token),
        json=[widget_type_id],
    )
    r.raise_for_status()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--device-id",
        default="",
        help="Default device ID to embed in widget settings",
    )
    args = parser.parse_args()

    # Read source files
    print("Reading source files...")
    template_html = read_file("template.html")
    template_css = read_file("template.css")
    controller_js = read_file("controller.js")
    settings_schema = json.loads(read_file("settings-schema.json"))

    print(f"  template.html: {len(template_html):,} bytes")
    print(f"  template.css:  {len(template_css):,} bytes")
    print(f"  controller.js: {len(controller_js):,} bytes")

    # Authenticate
    print("\nLogging in...")
    token = login()
    print("  Authenticated.")

    # Find or create bundle
    print(f"\nLooking for bundle '{BUNDLE_TITLE}'...")
    bundle = find_bundle(token)
    if bundle:
        print(f"  Found: {bundle['id']['id']}")
    else:
        print("  Not found. Creating...")
        bundle = create_bundle(token)
        print(f"  Created: {bundle['id']['id']}")

    bundle_id = bundle["id"]["id"]

    # Find existing widget type
    print(f"\nLooking for widget type '{WIDGET_NAME}'...")
    existing_wt = find_widget_types_by_bundle_id(token, bundle_id)

    if existing_wt:
        print(f"  Found: {existing_wt.get('id', {}).get('id', '?')}")
    else:
        print("  Not found. Will create new.")

    # Build and save
    wt_payload = build_widget_type(
        template_html, template_css, controller_js,
        settings_schema, args.device_id,
    )
    print("\nSaving widget type...")
    saved_wt = save_widget_type(token, wt_payload, existing_wt)
    wt_id = saved_wt.get("id", {}).get("id", "?")
    wt_fqn = saved_wt.get("fqn", "?")
    print(f"  Widget type ID:  {wt_id}")
    print(f"  Widget type FQN: {wt_fqn}")

    # Link to bundle
    print(f"\nLinking widget type to bundle...")
    link_widget_to_bundle(token, bundle_id, wt_id)
    print("  Linked.")

    # Verify
    print("\nVerifying widget type...")
    desc = saved_wt.get("descriptor", {})
    if isinstance(desc, str):
        desc = json.loads(desc)

    checks = [
        ("descriptor.type == 'static'",
         desc.get("type") == "static"),
        ("templateHtml contains 'dim-control'",
         "dim-control" in desc.get("templateHtml", "")),
        ("templateCss contains 'dim-slider'",
         "dim-slider" in desc.get("templateCss", "")),
        ("controllerScript contains 'self.onInit'",
         "self.onInit" in desc.get("controllerScript", "")),
        ("controllerScript contains 'self.ctx.http'",
         "self.ctx.http" in desc.get("controllerScript", "")),
        ("controllerScript contains 'DIM_CTRL'",
         "DIM_CTRL" in desc.get("controllerScript", "")),
        ("controllerScript contains 'SHARED_SCOPE'",
         "SHARED_SCOPE" in desc.get("controllerScript", "")),
        ("controllerScript does NOT contain hardcoded device ID",
         "41c198d0-0582-11f1" not in desc.get("controllerScript", "")),
        ("controllerScript does NOT contain localStorage",
         "localStorage" not in desc.get("controllerScript", "")),
    ]

    all_pass = True
    for label, ok in checks:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {label}")
        if not ok:
            all_pass = False

    if not all_pass:
        print("\nSome checks FAILED!")
        sys.exit(1)

    print("\n All checks passed!")
    print(f"\nWidget is available in Widget Library:")
    print(f"  Bundle: '{BUNDLE_TITLE}'")
    print(f"  Widget: '{WIDGET_NAME}'")
    print(f"  FQN:    tenant.{wt_fqn}")
    print(f"\nTo add to a dashboard:")
    print(f"  1. Edit dashboard → Add widget → '{BUNDLE_TITLE}' → '{WIDGET_NAME}'")
    print(f"  2. In widget settings, enter Device ID: 41c198d0-0582-11f1-999c-9b8fab55435e")
    print(f"     (or configure entity alias in datasource)")


if __name__ == "__main__":
    main()
