"""Tests for the ThingsBoard API client.

Run standalone:  python tests/test_tb_client.py
Run via pytest:  python -m pytest tests/test_tb_client.py -v -s
"""

from __future__ import annotations

import sys
import time

import pytest

sys.path.insert(0, ".")
from services.tb_client import TBClient, HierarchyResult, SiteNode, DeviceNode

# ---------------------------------------------------------------------------
# Test constants
# ---------------------------------------------------------------------------
CUSTOMER_ID = "6e1b23e0-fc24-11f0-999c-9b8fab55435e"  # Test Customer
DEVICE_ID = "41c198d0-0582-11f1-999c-9b8fab55435e"     # zenopix-test

THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def client() -> TBClient:
    c = TBClient()
    c.authenticate()
    return c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTBClient:

    def test_authenticate(self, client: TBClient):
        """JWT token should be non-empty."""
        assert client.token
        assert len(client.token) > 20
        print(f"  Token: {client.token[:40]}...")

    def test_resolve_hierarchy(self, client: TBClient):
        """Resolve full hierarchy from Test Customer."""
        result = client.resolve_hierarchy(CUSTOMER_ID, "CUSTOMER")

        assert isinstance(result, HierarchyResult)
        assert result.entity_type == "CUSTOMER"
        assert len(result.sites) >= 8, f"Expected >=8 sites, got {len(result.sites)}"

        total_devices = sum(len(s.devices) for s in result.sites)
        assert total_devices >= 20, f"Expected >=20 devices, got {total_devices}"

        # Print the full tree
        print(f"\n  Hierarchy: {result.name} ({result.entity_type})")
        print(f"  Sites: {len(result.sites)}  |  Devices: {total_devices}")
        for site in result.sites:
            print(f"    Site: {site.name} ({len(site.devices)} devices)")
            for dev in site.devices:
                print(f"      Device: {dev.name}  [{dev.id}]")

    def test_get_telemetry_sum(self, client: TBClient):
        """Fetch energy_wh SUM for zenopix-test over last 30 days."""
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - THIRTY_DAYS_MS

        value = client.get_telemetry_sum(DEVICE_ID, "energy_wh", start_ms, now_ms)

        assert isinstance(value, float)
        print(f"\n  energy_wh SUM (30d): {value}")

    def test_is_device_active(self, client: TBClient):
        """Check whether zenopix-test is active (last 10 min)."""
        active = client.is_device_active(DEVICE_ID)
        print(f"\n  zenopix-test active: {active}")
        # We don't assert True/False — just ensure it returns bool
        assert isinstance(active, bool)

    def test_get_alarm_history(self, client: TBClient):
        """Fetch alarms for zenopix-test over last 30 days."""
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - THIRTY_DAYS_MS

        alarms = client.get_alarm_history(DEVICE_ID, "DEVICE", start_ms, now_ms)

        assert isinstance(alarms, list)
        print(f"\n  Alarms (30d): {len(alarms)}")
        for alarm in alarms[:5]:
            print(f"    {alarm.get('type', '?')} — {alarm.get('severity', '?')} — {alarm.get('status', '?')}")


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

def _run_standalone():
    """Run tests directly without pytest."""
    client = TBClient()

    print("=" * 60)
    print("ThingsBoard Client — Standalone Test")
    print("=" * 60)

    # 1. Authenticate
    print("\n[1] Authenticate")
    token = client.authenticate()
    assert token and len(token) > 20
    print(f"  OK — token: {token[:40]}...")

    # 2. Resolve hierarchy
    print("\n[2] Resolve hierarchy (Test Customer)")
    result = client.resolve_hierarchy(CUSTOMER_ID, "CUSTOMER")
    total_devices = sum(len(s.devices) for s in result.sites)
    print(f"  {result.name}: {len(result.sites)} sites, {total_devices} devices")
    for site in result.sites:
        print(f"    {site.name} ({len(site.devices)} devices)")
        for dev in site.devices:
            print(f"      {dev.name}")
    assert len(result.sites) >= 8
    assert total_devices >= 20

    # 3. Telemetry sum
    print("\n[3] Telemetry SUM (energy_wh, 30d)")
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - THIRTY_DAYS_MS
    value = client.get_telemetry_sum(DEVICE_ID, "energy_wh", start_ms, now_ms)
    print(f"  energy_wh = {value}")

    # 4. Device active
    print("\n[4] Device active check")
    active = client.is_device_active(DEVICE_ID)
    print(f"  zenopix-test active: {active}")

    # 5. Alarm history
    print("\n[5] Alarm history (30d)")
    alarms = client.get_alarm_history(DEVICE_ID, "DEVICE", start_ms, now_ms)
    print(f"  {len(alarms)} alarms")
    for alarm in alarms[:5]:
        print(f"    {alarm.get('type', '?')} — {alarm.get('severity', '?')}")

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    _run_standalone()
