#!/usr/bin/env python3
"""Deploy DALI Task Scheduler as a Widget Library widget in ThingsBoard.

Creates/updates:
  - Widget bundle "Zenopix DALI"
  - Widget type "DALI Task Scheduler" (static widget)

Optional:
  --update-dashboard  Also migrate the existing HTML Card widget on the
                      Zenopix DALI Monitor dashboard to use the new library widget.
"""

import argparse
import json
import os
import sys

import requests

TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USER = os.getenv("TB_USER", "tenant@thingsboard.org")
TB_PASS = os.getenv("TB_PASS", "tenant")

DASHBOARD_ID = "c5e69900-05cb-11f1-999c-9b8fab55435e"
WIDGET_KEY = "7be5ad3d-194d-43dd-aaae-c4ad96d74760"

BUNDLE_TITLE = "Zenopix DALI"
WIDGET_NAME = "DALI Task Scheduler"

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

def find_widget_type(token, bundle_alias):
    """Find existing widget type in the bundle (legacy API, may 404/400)."""
    r = requests.get(
        f"{TB_URL}/api/widgetTypes?bundleAlias={bundle_alias}",
        headers=headers(token),
    )
    if r.status_code != 200:
        return None
    for wt in r.json():
        desc = wt.get("descriptor", {})
        if isinstance(desc, str):
            desc = json.loads(desc)
        if desc.get("name") == WIDGET_NAME or wt.get("name") == WIDGET_NAME:
            return wt
    return None


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
                # widgetTypesInfos returns info objects; fetch full type if needed
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


def build_widget_type(template_html, template_css, controller_js, settings_schema, bundle_obj):
    """Build the widget type JSON payload.

    bundle_obj: full bundle dict (with id, title, alias, etc.)
    """
    descriptor = {
        "type": "static",
        "sizeX": 24,
        "sizeY": 16,
        "resources": [],
        "templateHtml": template_html,
        "templateCss": template_css,
        "controllerScript": controller_js,
        "settingsSchema": json.dumps(settings_schema),
        "dataKeySettingsSchema": "{}",
        "defaultConfig": json.dumps({
            "datasources": [],
            "settings": {
                "pollIntervalMs": 30000,
                "deviceId": "",
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


# ─── Dashboard Update ─────────────────────────────────────────────────────────

def get_dashboard(token):
    r = requests.get(
        f"{TB_URL}/api/dashboard/{DASHBOARD_ID}", headers=headers(token)
    )
    r.raise_for_status()
    return r.json()


def save_dashboard(token, dashboard):
    r = requests.post(
        f"{TB_URL}/api/dashboard", headers=headers(token), json=dashboard
    )
    r.raise_for_status()
    return r.json()


def update_dashboard_widget(token, widget_fqn):
    """Migrate the HTML Card widget to use the new library widget."""
    dashboard = get_dashboard(token)
    config = dashboard.get("configuration", {})
    widgets = config.get("widgets", {})

    if WIDGET_KEY not in widgets:
        print(f"  WARNING: Widget key {WIDGET_KEY} not found in dashboard.")
        return False

    widget = widgets[WIDGET_KEY]
    old_fqn = widget.get("typeFullFqn", "")
    print(f"  Old typeFullFqn: {old_fqn}")
    print(f"  New typeFullFqn: {widget_fqn}")

    # Update widget type reference
    widget["typeFullFqn"] = widget_fqn

    # Clean old HTML Card settings, keep grid position
    wconfig = widget.get("config", {})
    settings = wconfig.get("settings", {})
    settings.pop("cardHtml", None)
    settings.pop("cardCss", None)
    settings.pop("html", None)
    settings.pop("css", None)
    settings["pollIntervalMs"] = 30000
    settings["deviceId"] = ""

    # Find the zenopixDevice entity alias UUID from dashboard config
    entity_aliases = config.get("entityAliases", {})
    alias_id = None
    for aid, alias_def in entity_aliases.items():
        if alias_def.get("alias") == "zenopixDevice":
            alias_id = aid
            break

    if alias_id:
        wconfig["datasources"] = [
            {
                "type": "entity",
                "entityAliasId": alias_id,
                "dataKeys": [],
            }
        ]
        print(f"  Datasource: entity alias '{alias_id}' (zenopixDevice)")
    else:
        print("  WARNING: 'zenopixDevice' alias not found. Datasource not set.")
        print("  You will need to configure the datasource manually in the widget.")

    saved = save_dashboard(token, dashboard)
    print(f"  Dashboard saved: {saved.get('title', '?')}")
    return True


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-dashboard",
        action="store_true",
        help="Also update the dashboard to use the new widget",
    )
    args = parser.parse_args()

    # Read source files
    print("Reading source files...")
    template_html = read_file("template.html")
    template_css = read_file("template.css")
    controller_js = read_file("controller.js")
    settings_schema = json.loads(read_file("settings-schema.json"))

    print(f"  template.html: {len(template_html)} bytes")
    print(f"  template.css:  {len(template_css)} bytes")
    print(f"  controller.js: {len(controller_js)} bytes")

    # Authenticate
    print("\nLogging in...")
    token = login()
    print("Authenticated.")

    # Find or create bundle
    print(f"\nLooking for bundle '{BUNDLE_TITLE}'...")
    bundle = find_bundle(token)
    if bundle:
        print(f"  Found: {bundle['id']['id']}")
    else:
        print("  Not found. Creating...")
        bundle = create_bundle(token)
        print(f"  Created: {bundle['id']['id']}")

    bundle_id = bundle["id"]

    # Find existing widget type
    print(f"\nLooking for widget type '{WIDGET_NAME}'...")
    existing_wt = find_widget_types_by_bundle_id(token, bundle_id["id"])
    if not existing_wt:
        bundle_alias = bundle.get("alias")
        if bundle_alias:
            existing_wt = find_widget_type(token, bundle_alias)

    if existing_wt:
        print(f"  Found: {existing_wt.get('id', {}).get('id', '?')}")
    else:
        print("  Not found. Will create new.")

    # Build and save widget type
    wt_payload = build_widget_type(
        template_html, template_css, controller_js, settings_schema, bundle
    )
    print("\nSaving widget type...")
    saved_wt = save_widget_type(token, wt_payload, existing_wt)
    wt_id = saved_wt.get("id", {}).get("id", "?")
    wt_fqn = saved_wt.get("fqn", "?")
    print(f"  Widget type ID: {wt_id}")
    print(f"  Widget type FQN: {wt_fqn}")

    # Link widget type to bundle
    print(f"\nLinking widget type to bundle...")
    link_widget_to_bundle(token, bundle_id["id"], wt_id)
    print("  Linked.")

    # Verify
    print("\nVerifying widget type...")
    desc = saved_wt.get("descriptor", {})
    if isinstance(desc, str):
        desc = json.loads(desc)
    checks = [
        ("descriptor.type == 'static'", desc.get("type") == "static"),
        ("templateHtml contains 'dali-scheduler'", "dali-scheduler" in desc.get("templateHtml", "")),
        ("templateCss contains 'slot-row-onoff'", "slot-row-onoff" in desc.get("templateCss", "")),
        ("controllerScript contains 'self.onInit'", "self.onInit" in desc.get("controllerScript", "")),
        ("controllerScript contains 'self.ctx.http'", "self.ctx.http" in desc.get("controllerScript", "")),
        ("controllerScript contains 'self.ctx.datasources'", "self.ctx.datasources" in desc.get("controllerScript", "")),
        ("controllerScript does NOT contain hardcoded DEVICE_ID", "41c198d0-0582-11f1" not in desc.get("controllerScript", "")),
        ("controllerScript does NOT contain getToken()", "getToken()" not in desc.get("controllerScript", "")),
        ("controllerScript does NOT contain localStorage", "localStorage" not in desc.get("controllerScript", "")),
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

    print("\nAll widget type checks passed!")

    # Optionally update dashboard
    if args.update_dashboard:
        print(f"\nUpdating dashboard {DASHBOARD_ID}...")
        type_full_fqn = "tenant." + wt_fqn
        ok = update_dashboard_widget(token, type_full_fqn)
        if ok:
            print("Dashboard updated successfully.")
        else:
            print("Dashboard update had warnings (see above).")

    print("\nDone! The widget is now available in the Widget Library under"
          f" '{BUNDLE_TITLE}' > '{WIDGET_NAME}'.")
    if not args.update_dashboard:
        print("Run with --update-dashboard to migrate the dashboard widget.")


if __name__ == "__main__":
    main()
