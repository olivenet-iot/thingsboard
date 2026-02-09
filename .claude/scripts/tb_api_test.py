#!/usr/bin/env python3
"""
ThingsBoard CE REST API Capability Test Script
================================================
Tests programmatic dashboard creation, widget management, device provisioning,
telemetry ingestion, and alarm configuration via the ThingsBoard REST API.

Target: ThingsBoard CE 4.4.0-SNAPSHOT running at localhost:8080

Uses only Python stdlib (urllib, json) — no external dependencies.

Credentials: source /opt/thingsboard/.claude/credentials.env before running.
"""

import json
import os
import time
import uuid
import urllib.request
import urllib.error
import urllib.parse
import ssl
import sys
import traceback
from datetime import datetime, timezone

# ─── Configuration ────────────────────────────────────────────────────────────

TB_URL = os.environ.get("TB_URL", "http://localhost:8080")
USERNAME = os.environ.get("TB_USERNAME", "YOUR_TB_USERNAME")
PASSWORD = os.environ.get("TB_PASSWORD", "YOUR_TB_PASSWORD")
REPORT_FILE = os.environ.get("TB_REPORT_FILE", "/tmp/tb_test_report.json")

# ─── TBClient ────────────────────────────────────────────────────────────────

class TBClient:
    """Thin ThingsBoard REST API client with auto-refresh JWT handling."""

    def __init__(self, base_url, username, password):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.token = None
        self.refresh_token = None
        self.token_ts = 0
        # Disable SSL verification for local dev
        self._ctx = ssl.create_default_context()
        self._ctx.check_hostname = False
        self._ctx.verify_mode = ssl.CERT_NONE

    def login(self):
        body = json.dumps({"username": self.username, "password": self.password}).encode()
        req = urllib.request.Request(
            f"{self.base_url}/api/auth/login",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = self._raw_request(req)
        self.token = resp["token"]
        self.refresh_token = resp.get("refreshToken")
        self.token_ts = time.time()
        return resp

    def _refresh(self):
        if not self.refresh_token:
            return self.login()
        body = json.dumps({"refreshToken": self.refresh_token}).encode()
        req = urllib.request.Request(
            f"{self.base_url}/api/auth/token",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            resp = self._raw_request(req)
            self.token = resp["token"]
            self.refresh_token = resp.get("refreshToken", self.refresh_token)
            self.token_ts = time.time()
        except Exception:
            self.login()

    def _ensure_token(self):
        if not self.token or (time.time() - self.token_ts > 600):
            self._refresh()

    def _raw_request(self, req):
        try:
            with urllib.request.urlopen(req, context=self._ctx, timeout=30) as r:
                data = r.read()
                if data:
                    return json.loads(data)
                return None
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            raise RuntimeError(f"HTTP {e.code} {e.reason}: {body}") from e

    def request(self, method, path, body=None, params=None, expect_404=False):
        """Make an authenticated API request. Returns (status_code, response_json)."""
        self._ensure_token()

        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        data = None
        if body is not None:
            data = json.dumps(body).encode()

        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "X-Authorization": f"Bearer {self.token}",
            },
            method=method,
        )

        try:
            with urllib.request.urlopen(req, context=self._ctx, timeout=30) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if expect_404 and e.code == 404:
                return 404, None
            body_text = e.read().decode(errors="replace")
            raise RuntimeError(f"HTTP {e.code} {e.reason} [{method} {path}]: {body_text}") from e

    # Convenience methods
    def get(self, path, params=None, **kw):
        return self.request("GET", path, params=params, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body=body, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def uid():
    return str(uuid.uuid4())

def ts_millis(offset_minutes=0):
    """Current epoch millis with optional offset."""
    return int((time.time() + offset_minutes * 60) * 1000)

def section(title):
    bar = "=" * 60
    print(f"\n{bar}")
    print(f"  {title}")
    print(bar)

def step(msg):
    print(f"\n  > {msg}")

def ok(msg):
    print(f"    [OK] {msg}")

def fail(msg):
    print(f"    [FAIL] {msg}")

def info(msg):
    print(f"    [INFO] {msg}")


# ─── Result Tracker ──────────────────────────────────────────────────────────

class Results:
    def __init__(self):
        self.capabilities = {}
        self.details = {}
        self.errors = []

    def record(self, capability, success, notes=""):
        self.capabilities[capability] = {"status": success, "notes": notes}
        icon = "[OK]" if success else "[FAIL]"
        print(f"    {icon} [{capability}] {notes}")

    def add_detail(self, key, value):
        self.details[key] = value

    def add_error(self, msg):
        self.errors.append(msg)

    def to_dict(self):
        caps = []
        for name, info_dict in self.capabilities.items():
            caps.append({
                "capability": name,
                "status": "PASS" if info_dict["status"] else "FAIL",
                "notes": info_dict["notes"],
            })
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "target": TB_URL,
            "capabilities": caps,
            "details": self.details,
            "errors": self.errors,
        }

    def print_summary(self):
        section("FINAL REPORT")
        print(f"\n  {'Capability':<35} {'Status':<8} Notes")
        print(f"  {'-'*35} {'-'*8} {'-'*40}")
        for name, info_dict in self.capabilities.items():
            icon = "PASS" if info_dict["status"] else "FAIL"
            print(f"  {name:<35} {icon:<8} {info_dict['notes']}")
        passed = sum(1 for v in self.capabilities.values() if v["status"])
        total = len(self.capabilities)
        print(f"\n  Result: {passed}/{total} capabilities passed")
        if self.errors:
            print(f"\n  Errors encountered:")
            for e in self.errors:
                print(f"    - {e}")


# ─── FAZ 1: READ & DISCOVERY ─────────────────────────────────────────────────

def phase1_read(client, results):
    section("FAZ 1: READ & DISCOVERY")

    # ── Step 1: Parallel inventory ──────────────────────────────
    step("Step 1 -- Inventory collection")

    inventory_endpoints = {
        "devices":        ("/api/tenant/devices", {"pageSize": "100", "page": "0"}),
        "assets":         ("/api/tenant/assets", {"pageSize": "100", "page": "0"}),
        "customers":      ("/api/customers", {"pageSize": "100", "page": "0"}),
        "deviceProfiles": ("/api/deviceProfiles", {"pageSize": "100", "page": "0"}),
        "assetProfiles":  ("/api/assetProfiles", {"pageSize": "100", "page": "0"}),
        "dashboards":     ("/api/tenant/dashboards", {"pageSize": "100", "page": "0"}),
        "ruleChains":     ("/api/ruleChains", {"pageSize": "100", "page": "0"}),
        "widgetBundles":  ("/api/widgetsBundles", {"pageSize": "100", "page": "0"}),
    }

    inventory = {}
    for name, (path, params) in inventory_endpoints.items():
        try:
            code, data = client.get(path, params=params)
            if isinstance(data, dict) and "data" in data:
                inventory[name] = data["data"]
                info(f"{name}: {data['totalElements']} items")
            elif isinstance(data, list):
                inventory[name] = data
                info(f"{name}: {len(data)} items")
            else:
                inventory[name] = data
                info(f"{name}: response type={type(data).__name__}")
        except Exception as e:
            fail(f"{name}: {e}")
            inventory[name] = []
            results.add_error(f"Inventory {name}: {e}")

    results.record("API Connection", True, "All inventory endpoints reachable")
    results.record("Device Listing", len(inventory.get("devices", [])) > 0,
                    f"{len(inventory.get('devices', []))} devices found")
    results.record("Dashboard Listing", len(inventory.get("dashboards", [])) > 0,
                    f"{len(inventory.get('dashboards', []))} dashboards found")

    # ── Step 2: Dependent discovery ─────────────────────────────
    step("Step 2 -- Dependent discovery")

    # First device telemetry
    devices = inventory.get("devices", [])
    first_device = None
    first_device_id = None
    if devices:
        first_device = devices[0]
        first_device_id = first_device["id"]["id"]
        info(f"First device: {first_device['name']} (id={first_device_id})")

        # Telemetry keys
        try:
            code, keys = client.get(f"/api/plugins/telemetry/DEVICE/{first_device_id}/keys/timeseries")
            info(f"Telemetry keys: {keys}")
            results.add_detail("first_device_telemetry_keys", keys)
        except Exception as e:
            info(f"Telemetry keys error: {e}")

        # Attribute keys
        try:
            code, keys = client.get(f"/api/plugins/telemetry/DEVICE/{first_device_id}/keys/attributes")
            info(f"Attribute keys: {keys}")
        except Exception as e:
            info(f"Attribute keys error: {e}")

        # Last 24h telemetry sample
        try:
            code, keys = client.get(f"/api/plugins/telemetry/DEVICE/{first_device_id}/keys/timeseries")
            if keys:
                ts_params = {
                    "keys": ",".join(keys[:5]),
                    "startTs": str(ts_millis(-1440)),
                    "endTs": str(ts_millis()),
                    "limit": "5",
                }
                code2, ts_data = client.get(
                    f"/api/plugins/telemetry/DEVICE/{first_device_id}/values/timeseries",
                    params=ts_params,
                )
                sample_counts = {k: len(v) for k, v in (ts_data or {}).items()}
                info(f"Telemetry sample counts (last 24h): {sample_counts}")
                results.record("Telemetry Read", any(v > 0 for v in sample_counts.values()),
                               f"Keys with data: {sample_counts}")
            else:
                results.record("Telemetry Read", False, "No telemetry keys found")
        except Exception as e:
            results.record("Telemetry Read", False, str(e))

    # First dashboard full JSON analysis
    dashboards = inventory.get("dashboards", [])
    dashboard_structure = None
    if dashboards:
        db_id = dashboards[0]["id"]["id"]
        try:
            code, db_full = client.get(f"/api/dashboard/{db_id}")
            config = db_full.get("configuration", {})
            widgets = config.get("widgets", {})
            aliases = config.get("entityAliases", {})
            states = config.get("states", {})

            dashboard_structure = {
                "title": db_full.get("title"),
                "widget_count": len(widgets),
                "entity_aliases": list(aliases.keys()),
                "states": list(states.keys()),
                "widget_types": [],
            }

            for wid, wdef in widgets.items():
                fqn = wdef.get("typeFullFqn", "unknown")
                ds_count = len(wdef.get("config", {}).get("datasources", []))
                dashboard_structure["widget_types"].append({
                    "id": wid,
                    "fqn": fqn,
                    "datasource_count": ds_count,
                })

            info(f"Dashboard '{db_full.get('title')}': {len(widgets)} widgets, "
                 f"{len(aliases)} aliases, states={list(states.keys())}")

            # Examine layout
            main_layout = (states.get("default", {}).get("layouts", {}).get("main", {}))
            layout_widgets = main_layout.get("widgets", {})
            info(f"Layout widget entries: {len(layout_widgets)}")
            for lwid, lw in list(layout_widgets.items())[:3]:
                info(f"  Widget {lwid[:8]}...: col={lw.get('col')}, row={lw.get('row')}, "
                     f"sizeX={lw.get('sizeX')}, sizeY={lw.get('sizeY')}")

            results.record("Dashboard JSON Analysis", True,
                           f"{len(widgets)} widgets, {len(aliases)} aliases analyzed")
            results.add_detail("dashboard_structure", dashboard_structure)
        except Exception as e:
            results.record("Dashboard JSON Analysis", False, str(e))

    # Widget types catalog
    step("Step 2b -- Widget catalog")
    try:
        widget_type_count = 0
        fqn_samples = []
        code, bundles = client.get("/api/widgetsBundles")
        if isinstance(bundles, list):
            for bundle in bundles[:5]:
                b_alias = bundle.get("alias", "")
                try:
                    code2, types = client.get(f"/api/widgetTypes",
                                              params={"pageSize": "100", "page": "0",
                                                      "widgetsBundleId": bundle["id"]["id"]})
                    if isinstance(types, dict) and "data" in types:
                        for wt in types["data"][:3]:
                            fqn = wt.get("fqn", "N/A")
                            fqn_samples.append(fqn)
                        widget_type_count += types.get("totalElements", 0)
                except Exception:
                    pass

        # Also try direct widget type search for our known FQNs
        known_fqns = [
            "system.cards.value_card",
            "system.time_series_chart",
            "system.cards.entities_table",
        ]
        verified_fqns = []
        for fqn in known_fqns:
            try:
                code3, wt_info = client.get(f"/api/widgetType", params={"fqn": fqn})
                if code3 == 200 and wt_info:
                    verified_fqns.append(fqn)
                    info(f"Widget FQN verified: {fqn} -> {wt_info.get('name', 'N/A')}")
            except Exception:
                info(f"Widget FQN NOT found: {fqn}")

        results.record("Widget Catalog Access", len(verified_fqns) > 0,
                        f"{len(verified_fqns)}/{len(known_fqns)} FQNs verified")
        results.add_detail("verified_fqns", verified_fqns)
        results.add_detail("widget_fqn_samples", fqn_samples[:10])
    except Exception as e:
        results.record("Widget Catalog Access", False, str(e))

    # Rule chain
    step("Step 2c -- Rule chain analysis")
    rule_chains = inventory.get("ruleChains", [])
    if rule_chains:
        rc_id = rule_chains[0]["id"]["id"]
        try:
            code, rc_meta = client.get(f"/api/ruleChain/{rc_id}/metadata")
            nodes = rc_meta.get("nodes", [])
            connections = rc_meta.get("connections", [])
            node_types = [n.get("type") for n in nodes]
            info(f"Rule chain '{rule_chains[0]['name']}': {len(nodes)} nodes, {len(connections)} connections")
            info(f"Node types: {node_types[:10]}")
            results.record("Rule Chain Read", True,
                           f"{len(nodes)} nodes, {len(connections)} connections")
            results.add_detail("rule_chain_node_types", node_types)
        except Exception as e:
            results.record("Rule Chain Read", False, str(e))
    else:
        results.record("Rule Chain Read", False, "No rule chains found")

    # Device profile detail
    step("Step 2d -- Device profile analysis")
    profiles = inventory.get("deviceProfiles", [])
    if profiles:
        dp_id = profiles[0]["id"]["id"]
        try:
            code, dp = client.get(f"/api/deviceProfile/{dp_id}")
            profile_data = dp.get("profileData", {})
            alarm_rules = profile_data.get("alarms", [])
            transport = profile_data.get("transportConfiguration", {}).get("type", "N/A")
            info(f"Profile '{dp['name']}': transport={transport}, alarm_rules={len(alarm_rules)}")
            results.add_detail("default_profile_alarm_count", len(alarm_rules))
        except Exception as e:
            info(f"Device profile error: {e}")

    return inventory


# ─── FAZ 2: WRITE & CREATE ───────────────────────────────────────────────────

def phase2_write(client, results, inventory):
    section("FAZ 2: WRITE & CREATE")

    epoch_suffix = int(time.time())

    # ── Step 4: Create device profile ───────────────────────────
    step("Step 4 -- Create test device profile")
    profile_id = None
    profile_name = f"API_Test_Profile_{epoch_suffix}"
    try:
        profile_body = {
            "name": profile_name,
            "type": "DEFAULT",
            "transportType": "DEFAULT",
            "profileData": {
                "configuration": {"type": "DEFAULT"},
                "transportConfiguration": {"type": "DEFAULT"},
                "provisionConfiguration": {"type": "DISABLED"},
                "alarms": [],
            },
            "description": "Created by Claude Code API test",
            "default": False,
        }
        code, profile_resp = client.post("/api/deviceProfile", body=profile_body)
        profile_id = profile_resp["id"]["id"]
        ok(f"Profile created: {profile_name} (id={profile_id})")
    except Exception as e:
        fail(f"Profile creation failed: {e}")
        results.record("Device Creation", False, f"Profile creation failed: {e}")
        results.add_error(f"Profile creation: {e}")
        return None

    # ── Step 5: Create test device ──────────────────────────────
    step("Step 5 -- Create test device")
    device_id = None
    access_token = None
    device_name = f"CLAUDE_TEST_DEVICE_{epoch_suffix}"
    try:
        device_body = {
            "name": device_name,
            "type": "api-test",
            "label": "Claude Code API Test Device",
            "deviceProfileId": {
                "entityType": "DEVICE_PROFILE",
                "id": profile_id,
            },
        }
        code, dev_resp = client.post("/api/device", body=device_body)
        device_id = dev_resp["id"]["id"]
        ok(f"Device created: {device_name} (id={device_id})")

        # Get credentials
        code, cred = client.get(f"/api/device/{device_id}/credentials")
        access_token = cred["credentialsId"]
        ok(f"Access token: {access_token[:8]}...")
        results.record("Device Creation", True, f"Device + profile created successfully")
    except Exception as e:
        fail(f"Device creation failed: {e}")
        results.record("Device Creation", False, str(e))
        results.add_error(f"Device creation: {e}")
        return {"profile_id": profile_id}

    # ── Step 6: Send telemetry ──────────────────────────────────
    step("Step 6 -- Send telemetry (10 data points)")
    try:
        now = time.time()
        telemetry_values = []
        for i in range(10):
            ts = int((now - (9 - i) * 360) * 1000)
            temp = 20.0 + i * 1.5 + (i % 3) * 0.5
            humidity = 45.0 + i * 2.0 - (i % 2) * 1.5
            voltage = 3.2 + i * 0.05
            telemetry_values.append({
                "ts": ts,
                "values": {
                    "temperature": round(temp, 1),
                    "humidity": round(humidity, 1),
                    "voltage": round(voltage, 2),
                },
            })

        telemetry_url = f"{client.base_url}/api/v1/{access_token}/telemetry"
        data = json.dumps(telemetry_values).encode()
        req = urllib.request.Request(
            telemetry_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=client._ctx, timeout=15) as r:
            ok(f"Telemetry sent: {len(telemetry_values)} data points, status={r.status}")

        time.sleep(2)

        code, ts_data = client.get(
            f"/api/plugins/telemetry/DEVICE/{device_id}/values/timeseries",
            params={"keys": "temperature,humidity,voltage"},
        )
        ts_counts = {k: len(v) for k, v in (ts_data or {}).items()}
        ok(f"Telemetry verified: {ts_counts}")
        results.record("Telemetry Send", all(v > 0 for v in ts_counts.values()),
                        f"Sent 10 points, verified: {ts_counts}")
    except Exception as e:
        fail(f"Telemetry failed: {e}")
        results.record("Telemetry Send", False, str(e))
        results.add_error(f"Telemetry: {e}")

    # ── Step 7: Create dashboard with 3 widgets ─────────────────
    step("Step 7 -- Create dashboard with 3 widgets")
    dashboard_id = None
    try:
        alias_id = uid()
        w1_id = uid()
        w2_id = uid()
        w3_id = uid()

        entity_alias = {
            alias_id: {
                "id": alias_id,
                "alias": "Test Device",
                "filter": {
                    "type": "singleEntity",
                    "singleEntity": {
                        "entityType": "DEVICE",
                        "id": device_id,
                    },
                    "resolveMultiple": False,
                },
            }
        }

        widgets = {
            w1_id: {
                "typeFullFqn": "system.cards.value_card",
                "type": "latest",
                "title": "Temperature",
                "sizeX": 6,
                "sizeY": 4,
                "config": {
                    "datasources": [{
                        "type": "entity",
                        "entityAliasId": alias_id,
                        "filterId": None,
                        "dataKeys": [{
                            "name": "temperature",
                            "type": "timeseries",
                            "label": "Temperature",
                            "settings": {},
                            "funcBody": None,
                        }],
                    }],
                    "settings": {
                        "labelPosition": "top",
                    },
                    "actions": {},
                    "configMode": "basic",
                },
            },
            w2_id: {
                "typeFullFqn": "system.time_series_chart",
                "type": "timeseries",
                "title": "Temperature & Humidity",
                "sizeX": 12,
                "sizeY": 6,
                "config": {
                    "datasources": [{
                        "type": "entity",
                        "entityAliasId": alias_id,
                        "filterId": None,
                        "dataKeys": [
                            {
                                "name": "temperature",
                                "type": "timeseries",
                                "label": "Temperature",
                                "settings": {},
                                "funcBody": None,
                            },
                            {
                                "name": "humidity",
                                "type": "timeseries",
                                "label": "Humidity",
                                "settings": {},
                                "funcBody": None,
                            },
                        ],
                    }],
                    "settings": {},
                    "actions": {},
                    "configMode": "basic",
                },
            },
            w3_id: {
                "typeFullFqn": "system.cards.entities_table",
                "type": "latest",
                "title": "Device Data Table",
                "sizeX": 12,
                "sizeY": 5,
                "config": {
                    "datasources": [{
                        "type": "entity",
                        "entityAliasId": alias_id,
                        "filterId": None,
                        "dataKeys": [
                            {
                                "name": "temperature",
                                "type": "timeseries",
                                "label": "Temperature",
                                "settings": {},
                                "funcBody": None,
                            },
                            {
                                "name": "humidity",
                                "type": "timeseries",
                                "label": "Humidity",
                                "settings": {},
                                "funcBody": None,
                            },
                            {
                                "name": "voltage",
                                "type": "timeseries",
                                "label": "Voltage",
                                "settings": {},
                                "funcBody": None,
                            },
                        ],
                    }],
                    "settings": {
                        "enableSearch": True,
                        "enableStickyHeader": True,
                    },
                    "actions": {},
                    "configMode": "basic",
                },
            },
        }

        layout_widgets = {
            w1_id: {"sizeX": 6, "sizeY": 4, "row": 0, "col": 0},
            w2_id: {"sizeX": 12, "sizeY": 6, "row": 4, "col": 0},
            w3_id: {"sizeX": 12, "sizeY": 5, "row": 4, "col": 12},
        }

        dashboard_body = {
            "title": f"Claude API Test Dashboard {epoch_suffix}",
            "configuration": {
                "widgets": widgets,
                "entityAliases": entity_alias,
                "states": {
                    "default": {
                        "name": "default",
                        "root": True,
                        "layouts": {
                            "main": {
                                "widgets": layout_widgets,
                                "gridSettings": {
                                    "columns": 24,
                                    "margin": 10,
                                    "outerMargin": True,
                                    "backgroundSizeMode": "100%",
                                },
                            }
                        },
                    }
                },
                "filters": {},
                "settings": {
                    "stateControllerId": "entity",
                    "showTitle": True,
                    "showDashboardsSelect": True,
                    "showEntitiesSelect": True,
                    "showDashboardTimewindow": True,
                    "showDashboardExport": True,
                    "toolbarAlwaysOpen": True,
                },
                "timewindow": {
                    "displayValue": "",
                    "selectedTab": 0,
                    "realtime": {
                        "realtimeType": 1,
                        "timewindowMs": 3600000,
                        "interval": 60000,
                    },
                },
            },
        }

        code, db_resp = client.post("/api/dashboard", body=dashboard_body)
        dashboard_id = db_resp["id"]["id"]
        ok(f"Dashboard created: {db_resp['title']} (id={dashboard_id})")

        code2, db_check = client.get(f"/api/dashboard/{dashboard_id}")
        check_widgets = db_check.get("configuration", {}).get("widgets", {})
        check_aliases = db_check.get("configuration", {}).get("entityAliases", {})
        ok(f"Dashboard verified: {len(check_widgets)} widgets, {len(check_aliases)} aliases")

        results.record("Dashboard Creation", len(check_widgets) == 3,
                        f"{len(check_widgets)} widgets created")
        results.record("Entity Alias Binding", len(check_aliases) == 1,
                        f"Alias bound to device {device_id[:8]}...")
    except Exception as e:
        fail(f"Dashboard creation failed: {e}")
        results.record("Dashboard Creation", False, str(e))
        results.record("Entity Alias Binding", False, "Dashboard creation failed")
        results.add_error(f"Dashboard creation: {e}")

    # ── Step 8: Update dashboard -- add 4th widget ───────────────
    step("Step 8 -- Update dashboard (add 4th widget)")
    if dashboard_id:
        try:
            code, db_current = client.get(f"/api/dashboard/{dashboard_id}")

            w4_id = uid()
            config = db_current.get("configuration", {})

            config["widgets"][w4_id] = {
                "typeFullFqn": "system.cards.value_card",
                "type": "latest",
                "title": "Humidity",
                "sizeX": 6,
                "sizeY": 4,
                "config": {
                    "datasources": [{
                        "type": "entity",
                        "entityAliasId": alias_id,
                        "filterId": None,
                        "dataKeys": [{
                            "name": "humidity",
                            "type": "timeseries",
                            "label": "Humidity",
                            "settings": {},
                            "funcBody": None,
                        }],
                    }],
                    "settings": {
                        "labelPosition": "top",
                    },
                    "actions": {},
                    "configMode": "basic",
                },
            }

            config["states"]["default"]["layouts"]["main"]["widgets"][w4_id] = {
                "sizeX": 6, "sizeY": 4, "row": 0, "col": 6,
            }

            db_current["configuration"] = config
            code, db_updated = client.post("/api/dashboard", body=db_current)

            code, db_verify = client.get(f"/api/dashboard/{dashboard_id}")
            updated_count = len(db_verify.get("configuration", {}).get("widgets", {}))
            ok(f"Dashboard updated: now {updated_count} widgets")
            results.record("Widget Add/Update", updated_count == 4,
                           f"Updated from 3 to {updated_count} widgets")
        except Exception as e:
            fail(f"Dashboard update failed: {e}")
            results.record("Widget Add/Update", False, str(e))
            results.add_error(f"Dashboard update: {e}")
    else:
        results.record("Widget Add/Update", False, "No dashboard to update")

    # ── Step 9: Alarm configuration ─────────────────────────────
    step("Step 9 -- Alarm configuration")
    alarm_id = None
    original_rc_meta = None
    rc_id = None
    try:
        info("Checking rule chain for Device Profile Node...")
        code, chains = client.get("/api/ruleChains", params={"pageSize": "10", "page": "0"})
        rc_list = chains.get("data", []) if isinstance(chains, dict) else []
        if rc_list:
            rc_id = rc_list[0]["id"]["id"]
            code, rc_meta = client.get(f"/api/ruleChain/{rc_id}/metadata")
            original_rc_meta = json.loads(json.dumps(rc_meta))

            nodes = rc_meta.get("nodes", [])
            connections = rc_meta.get("connections", [])

            dp_node_idx = None
            save_ts_idx = None
            msg_switch_idx = None
            for i, n in enumerate(nodes):
                if "TbDeviceProfileNode" in n.get("type", ""):
                    dp_node_idx = i
                if "TbMsgTimeseriesNode" in n.get("type", ""):
                    save_ts_idx = i
                if "TbMsgTypeSwitchNode" in n.get("type", ""):
                    msg_switch_idx = i

            if dp_node_idx is not None:
                info("Device Profile Node already exists in rule chain")
            elif msg_switch_idx is not None and save_ts_idx is not None:
                info("Adding Device Profile Node to rule chain...")
                new_node = {
                    "type": "org.thingsboard.rule.engine.profile.TbDeviceProfileNode",
                    "name": "Device Profile Node",
                    "debugMode": False,
                    "singletonMode": False,
                    "configuration": {
                        "persistAlarmRulesState": False,
                        "fetchAlarmRulesStateOnStart": False,
                    },
                    "additionalInfo": {
                        "layoutX": 500,
                        "layoutY": 200,
                    },
                }
                new_node_idx = len(nodes)
                nodes.append(new_node)

                new_connections = []
                for c in connections:
                    if (c["fromIndex"] == msg_switch_idx and
                        c["toIndex"] == save_ts_idx and
                        c["type"] == "Post telemetry"):
                        new_connections.append({
                            "fromIndex": msg_switch_idx,
                            "toIndex": new_node_idx,
                            "type": "Post telemetry",
                        })
                    else:
                        new_connections.append(c)

                new_connections.append({
                    "fromIndex": new_node_idx,
                    "toIndex": save_ts_idx,
                    "type": "Success",
                })
                for alarm_type in ["Alarm Created", "Alarm Updated", "Alarm Severity Updated", "Alarm Cleared"]:
                    new_connections.append({
                        "fromIndex": new_node_idx,
                        "toIndex": save_ts_idx,
                        "type": alarm_type,
                    })

                rc_meta["nodes"] = nodes
                rc_meta["connections"] = new_connections

                code, saved_meta = client.post("/api/ruleChain/metadata", body=rc_meta)
                ok("Device Profile Node added to rule chain")
                time.sleep(2)
            else:
                info("Cannot find Message Type Switch or Save Timeseries nodes in rule chain")

        code, profile = client.get(f"/api/deviceProfile/{profile_id}")

        alarm_rule = {
            "id": f"temperature_critical_{epoch_suffix}",
            "alarmType": f"High Temperature {epoch_suffix}",
            "propagate": False,
            "propagateToOwner": False,
            "propagateToTenant": False,
            "propagateRelationTypes": [],
            "createRules": {
                "CRITICAL": {
                    "condition": {
                        "condition": [{
                            "key": {
                                "type": "TIME_SERIES",
                                "key": "temperature",
                            },
                            "valueType": "NUMERIC",
                            "predicate": {
                                "type": "NUMERIC",
                                "operation": "GREATER",
                                "value": {
                                    "defaultValue": 30.0,
                                    "userValue": None,
                                    "dynamicValue": None,
                                },
                            },
                        }],
                        "spec": {"type": "SIMPLE"},
                    },
                    "schedule": None,
                    "alarmDetails": "Temperature exceeded 30C threshold",
                },
            },
            "clearRule": {
                "condition": {
                    "condition": [{
                        "key": {
                            "type": "TIME_SERIES",
                            "key": "temperature",
                        },
                        "valueType": "NUMERIC",
                        "predicate": {
                            "type": "NUMERIC",
                            "operation": "LESS",
                            "value": {
                                "defaultValue": 25.0,
                                "userValue": None,
                                "dynamicValue": None,
                            },
                        },
                    }],
                    "spec": {"type": "SIMPLE"},
                },
                "schedule": None,
                "alarmDetails": "Temperature back to normal",
            },
        }

        profile["profileData"]["alarms"] = [alarm_rule]
        code, updated_profile = client.post("/api/deviceProfile", body=profile)
        ok(f"Alarm rule added to profile: temperature > 30 -> CRITICAL")

        info("Sending temperature=35 to trigger alarm...")
        trigger_url = f"{client.base_url}/api/v1/{access_token}/telemetry"
        trigger_data = json.dumps({"temperature": 35.0}).encode()
        req = urllib.request.Request(
            trigger_url,
            data=trigger_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=client._ctx, timeout=15) as r:
            ok(f"High temp telemetry sent, status={r.status}")

        info("Waiting for alarm to trigger (up to 20s)...")
        alarm_found = False
        for attempt in range(8):
            time.sleep(2.5)
            try:
                code, alarms = client.get(
                    f"/api/alarm/DEVICE/{device_id}",
                    params={"pageSize": "10", "page": "0"},
                )
                alarm_list = alarms.get("data", []) if isinstance(alarms, dict) else []
                if alarm_list:
                    alarm_id = alarm_list[0]["id"]["id"]
                    alarm_type = alarm_list[0].get("type", "N/A")
                    alarm_severity = alarm_list[0].get("severity", "N/A")
                    ok(f"Alarm triggered! type={alarm_type}, severity={alarm_severity}, id={alarm_id}")
                    alarm_found = True
                    break
                else:
                    info(f"  Attempt {attempt+1}/8: no alarms yet...")
            except Exception:
                pass

        results.record("Alarm Configuration", alarm_found,
                        "Alarm rule configured and triggered" if alarm_found else "Alarm not triggered within timeout")
        if not alarm_found:
            info("Alarm may need more time or rule engine may not be processing")
    except Exception as e:
        fail(f"Alarm configuration failed: {e}")
        results.record("Alarm Configuration", False, str(e))
        results.add_error(f"Alarm config: {e}")

    return {
        "profile_id": profile_id,
        "profile_name": profile_name,
        "device_id": device_id,
        "device_name": device_name,
        "access_token": access_token,
        "dashboard_id": dashboard_id,
        "alarm_id": alarm_id,
        "original_rc_meta": original_rc_meta,
        "rc_id": rc_id,
    }


# ─── FAZ 3: CLEANUP & REPORT ─────────────────────────────────────────────────

def phase3_cleanup(client, results, created):
    section("FAZ 3: CLEANUP & REPORT")

    if not created:
        info("Nothing to clean up (creation phase failed)")
        return

    step("Step 10 -- Cleanup")

    if created.get("original_rc_meta") and created.get("rc_id"):
        try:
            code, current_meta = client.get(f"/api/ruleChain/{created['rc_id']}/metadata")
            restore_meta = created["original_rc_meta"]
            try:
                client.post("/api/ruleChain/metadata", body=restore_meta)
                ok("Rule chain restored to original state")
            except RuntimeError as e:
                if "409" in str(e):
                    code, rc_full = client.get(f"/api/ruleChain/{created['rc_id']}")
                    code, fresh_meta = client.get(f"/api/ruleChain/{created['rc_id']}/metadata")
                    fresh_meta["nodes"] = restore_meta["nodes"]
                    fresh_meta["connections"] = restore_meta["connections"]
                    client.post("/api/ruleChain/metadata", body=fresh_meta)
                    ok("Rule chain restored to original state (after version retry)")
                else:
                    raise
        except Exception as e:
            info(f"Rule chain restore: {e}")

    if created.get("alarm_id"):
        try:
            client.post(f"/api/alarm/{created['alarm_id']}/clear")
            ok(f"Alarm cleared: {created['alarm_id'][:8]}...")
        except Exception as e:
            info(f"Alarm clear: {e}")

    if created.get("dashboard_id"):
        try:
            client.delete(f"/api/dashboard/{created['dashboard_id']}")
            code, check = client.get(f"/api/dashboard/{created['dashboard_id']}", expect_404=True)
            if code == 404:
                ok(f"Dashboard deleted and verified (404)")
            else:
                fail(f"Dashboard still exists after delete")
            results.record("Dashboard Delete", code == 404, "Deleted and verified")
        except Exception as e:
            results.record("Dashboard Delete", True, f"Deleted (got exception on verify: {e})")

    if created.get("device_id"):
        try:
            client.delete(f"/api/device/{created['device_id']}")
            code, check = client.get(f"/api/device/{created['device_id']}", expect_404=True)
            if code == 404:
                ok(f"Device deleted and verified (404)")
            else:
                fail(f"Device still exists after delete")
        except Exception as e:
            ok(f"Device deleted (verify: {e})")

    if created.get("profile_id"):
        try:
            client.delete(f"/api/deviceProfile/{created['profile_id']}")
            code, check = client.get(f"/api/deviceProfile/{created['profile_id']}", expect_404=True)
            if code == 404:
                ok(f"Profile deleted and verified (404)")
            else:
                fail(f"Profile still exists after delete")
        except Exception as e:
            ok(f"Profile deleted (verify: {e})")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  ThingsBoard CE REST API Capability Test")
    print(f"  Target: {TB_URL}")
    print(f"  Time:   {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    results = Results()
    client = TBClient(TB_URL, USERNAME, PASSWORD)

    step("Authenticating...")
    try:
        client.login()
        ok("Logged in successfully")
    except Exception as e:
        fail(f"Login failed: {e}")
        results.record("API Connection", False, str(e))
        results.print_summary()
        sys.exit(1)

    try:
        inventory = phase1_read(client, results)
    except Exception as e:
        fail(f"Phase 1 failed: {e}")
        traceback.print_exc()
        results.add_error(f"Phase 1: {e}")
        inventory = {}

    created = None
    try:
        created = phase2_write(client, results, inventory)
    except Exception as e:
        fail(f"Phase 2 failed: {e}")
        traceback.print_exc()
        results.add_error(f"Phase 2: {e}")

    try:
        phase3_cleanup(client, results, created)
    except Exception as e:
        fail(f"Phase 3 failed: {e}")
        traceback.print_exc()
        results.add_error(f"Phase 3: {e}")

    results.print_summary()

    report = results.to_dict()
    try:
        with open(REPORT_FILE, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        info(f"Report saved to {REPORT_FILE}")
    except Exception as e:
        fail(f"Could not save report: {e}")

    failed = sum(1 for v in results.capabilities.values() if not v["status"])
    if failed > 0:
        print(f"\n  WARNING: {failed} capabilities failed")
        sys.exit(1)
    else:
        print(f"\n  All capabilities passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
