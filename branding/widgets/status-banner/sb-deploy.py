#!/usr/bin/env python3
"""Deploy Status Banner as a Widget Library widget in ThingsBoard.

Creates/updates:
  - Widget bundle "SignConnect"
  - Widget type "Status Banner" (static widget)

Usage:
  python3 deploy.py
  python3 deploy.py --device-id UUID
"""

import argparse
import json
import os
import sys

import requests

TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USER = os.getenv("TB_USER", "support@lumosoft.io")
TB_PASS = os.getenv("TB_PASS", "tenant")

BUNDLE_TITLE = "SignConnect"
WIDGET_NAME = "Status Banner"

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


def find_bundle(token):
    r = requests.get(f"{TB_URL}/api/widgetsBundles", headers=headers(token))
    r.raise_for_status()
    for b in r.json():
        if b.get("title") == BUNDLE_TITLE:
            return b
    return None


def create_bundle(token):
    body = {"title": BUNDLE_TITLE}
    r = requests.post(
        f"{TB_URL}/api/widgetsBundle", headers=headers(token), json=body
    )
    r.raise_for_status()
    return r.json()


def find_widget_types_by_bundle_id(token, bundle_id):
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
    descriptor = {
        "type": "static",
        "sizeX": 24,
        "sizeY": 3,
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
                "offlineThresholdMin": 60,
                "deviceId": device_id,
            },
        }),
    }
    return {
        "name": WIDGET_NAME,
        "descriptor": descriptor,
    }


def save_widget_type(token, widget_type_payload, existing=None):
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
    r = requests.post(
        f"{TB_URL}/api/widgetsBundle/{bundle_id}/widgetTypes",
        headers=headers(token),
        json=[widget_type_id],
    )
    r.raise_for_status()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-id", default="",
                        help="Default device ID for widget settings")
    args = parser.parse_args()

    print("Reading source files...")
    template_html = read_file("template.html")
    template_css = read_file("template.css")
    controller_js = read_file("controller.js")
    settings_schema = json.loads(read_file("settings-schema.json"))

    print(f"  template.html: {len(template_html):,} bytes")
    print(f"  template.css:  {len(template_css):,} bytes")
    print(f"  controller.js: {len(controller_js):,} bytes")

    print("\nLogging in...")
    token = login()
    print("  Authenticated.")

    print(f"\nLooking for bundle '{BUNDLE_TITLE}'...")
    bundle = find_bundle(token)
    if bundle:
        print(f"  Found: {bundle['id']['id']}")
    else:
        print("  Not found. Creating...")
        bundle = create_bundle(token)
        print(f"  Created: {bundle['id']['id']}")

    bundle_id = bundle["id"]["id"]

    print(f"\nLooking for widget type '{WIDGET_NAME}'...")
    existing_wt = find_widget_types_by_bundle_id(token, bundle_id)
    if existing_wt:
        print(f"  Found: {existing_wt.get('id', {}).get('id', '?')}")
    else:
        print("  Not found. Will create new.")

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
        ("sizeX == 24 (full width)",
         desc.get("sizeX") == 24),
        ("sizeY == 3 (banner height)",
         desc.get("sizeY") == 3),
        ("templateHtml contains 'status-banner'",
         "status-banner" in desc.get("templateHtml", "")),
        ("templateCss contains 'sb-zone'",
         "sb-zone" in desc.get("templateCss", "")),
        ("controllerScript contains 'self.onInit'",
         "self.onInit" in desc.get("controllerScript", "")),
        ("controllerScript contains 'self.ctx.http'",
         "self.ctx.http" in desc.get("controllerScript", "")),
        ("controllerScript contains 'FAULT_MAP'",
         "FAULT_MAP" in desc.get("controllerScript", "")),
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


if __name__ == "__main__":
    main()
