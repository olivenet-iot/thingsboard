#!/usr/bin/env python3
"""
Patch nav-tree widget settings on live dashboards.

Finds every dashboard that contains a nav-tree widget and ensures
fleetDashboardId, standardDashboardId, and plusDashboardId are set.

Usage:
  python3 patch-dashboard-settings.py
"""

import json
import os
import sys
import requests

TB_URL = os.getenv("TB_URL", "http://localhost:8080")
TB_USER = os.getenv("TB_USER", "support@lumosoft.io")
TB_PASS = os.getenv("TB_PASS", "tenant")

REQUIRED_SETTINGS = {
    "fleetDashboardId": "b6d83390-0c08-11f1-9f20-c3880cf3b963",
    "standardDashboardId": "57108320-0764-11f1-9f20-c3880cf3b963",
    "plusDashboardId": "549a40a0-0f33-11f1-9f20-c3880cf3b963",
}


def get_token():
    resp = requests.post(f"{TB_URL}/api/auth/login",
                         json={"username": TB_USER, "password": TB_PASS})
    resp.raise_for_status()
    return resp.json()["token"]


def get_all_dashboards(hdrs):
    """Fetch all tenant dashboards (paginated)."""
    dashboards = []
    page = 0
    while True:
        resp = requests.get(
            f"{TB_URL}/api/tenant/dashboards?pageSize=100&page={page}&sortProperty=title&sortOrder=ASC",
            headers=hdrs,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("data", [])
        dashboards.extend(items)
        if not data.get("hasNext", False):
            break
        page += 1
    return dashboards


def patch_dashboard(hdrs, dashboard_id):
    """
    GET full dashboard, find nav-tree widgets, patch settings, POST back.
    Returns True if any changes were made.
    """
    resp = requests.get(f"{TB_URL}/api/dashboard/{dashboard_id}", headers=hdrs)
    resp.raise_for_status()
    dash = resp.json()

    widgets = dash.get("configuration", {}).get("widgets", {})
    changed = False

    for wid, widget_cfg in widgets.items():
        config = widget_cfg.get("config", {})
        settings = config.get("settings", {})

        # Identify nav-tree widget by title or known settings
        title = config.get("title", "")
        is_nav_tree = (
            title == "Navigation Tree"
            or "brandName" in settings
            or widget_cfg.get("typeFullFqn", "").endswith("nav_tree")
        )

        if not is_nav_tree:
            continue

        for key, value in REQUIRED_SETTINGS.items():
            if not settings.get(key):
                settings[key] = value
                changed = True
                print(f"    Set {key} = {value}")

        if changed:
            config["settings"] = settings
            widget_cfg["config"] = config

    if not changed:
        return False

    # POST back
    resp = requests.post(f"{TB_URL}/api/dashboard", headers=hdrs, json=dash)
    resp.raise_for_status()
    return True


def main():
    print("=" * 55)
    print("  Patching nav-tree widget settings on live dashboards")
    print(f"  Target: {TB_URL}")
    print("=" * 55)

    token = get_token()
    hdrs = {
        "Content-Type": "application/json",
        "X-Authorization": f"Bearer {token}",
    }

    dashboards = get_all_dashboards(hdrs)
    print(f"\n  Found {len(dashboards)} dashboards")

    patched = 0
    for d in dashboards:
        did = d["id"]["id"]
        title = d.get("title", "")
        print(f"\n  Checking: {title} ({did})")
        try:
            if patch_dashboard(hdrs, did):
                patched += 1
                print(f"    -> Patched!")
            else:
                print(f"    -> No nav-tree widget or already configured")
        except Exception as e:
            print(f"    -> Error: {e}")

    print(f"\n{'=' * 55}")
    print(f"  Done! Patched {patched} dashboard(s)")
    print(f"{'=' * 55}")


if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.ConnectionError:
        print(f"Error: Cannot connect to {TB_URL}")
        print("  Is ThingsBoard running?")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e}")
        if e.response is not None:
            print(f"  Response: {e.response.text[:500]}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
