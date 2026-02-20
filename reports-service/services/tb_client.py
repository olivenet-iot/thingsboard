"""ThingsBoard REST API client for reports-service."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import requests

from config import TB_URL, TB_USERNAME, TB_PASSWORD

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class DeviceNode:
    id: str
    name: str


@dataclass
class SiteNode:
    id: str
    name: str
    devices: list[DeviceNode] = field(default_factory=list)


@dataclass
class HierarchyResult:
    id: str
    name: str
    entity_type: str
    asset_type: str | None
    sites: list[SiteNode] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class TBClient:
    """Thin wrapper around the ThingsBoard REST API."""

    def __init__(
        self,
        base_url: str = TB_URL,
        username: str = TB_USERNAME,
        password: str = TB_PASSWORD,
    ):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.token: str | None = None

    # -- auth ---------------------------------------------------------------

    def authenticate(self) -> str:
        """Obtain a JWT and attach it to the session headers."""
        resp = self.session.post(
            f"{self.base_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
        )
        resp.raise_for_status()
        self.token = resp.json()["token"]
        self.session.headers["X-Authorization"] = f"Bearer {self.token}"
        return self.token

    # -- generic request wrapper --------------------------------------------

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        """Execute a request; re-authenticate once on 401."""
        if self.token is None:
            self.authenticate()

        url = f"{self.base_url}{path}"
        resp = self.session.request(method, url, **kwargs)

        if resp.status_code == 401:
            logger.info("JWT expired — re-authenticating")
            self.authenticate()
            resp = self.session.request(method, url, **kwargs)

        resp.raise_for_status()
        return resp

    # -- entity lookups -----------------------------------------------------

    def get_asset(self, asset_id: str) -> dict:
        """Return asset dict (has 'name', 'type', etc.)."""
        return self._request("GET", f"/api/asset/{asset_id}").json()

    def get_device(self, device_id: str) -> dict:
        """Return device dict (has 'name', 'type', etc.)."""
        return self._request("GET", f"/api/device/{device_id}").json()

    def get_customer(self, customer_id: str) -> dict:
        """Return customer dict (name is in 'title' field)."""
        return self._request("GET", f"/api/customer/{customer_id}").json()

    # -- relations ----------------------------------------------------------

    def get_relations(self, entity_id: str, entity_type: str) -> list[dict]:
        """Return 'Contains' relations from given entity."""
        params = {
            "fromId": entity_id,
            "fromType": entity_type,
            "relationType": "Contains",
            "relationTypeGroup": "COMMON",
        }
        return self._request("GET", "/api/relations", params=params).json()

    def get_customer_assets(self, customer_id: str) -> list[dict]:
        """Return all assets assigned to a customer (paginated)."""
        assets: list[dict] = []
        page = 0
        while True:
            resp = self._request(
                "GET",
                f"/api/customer/{customer_id}/assets",
                params={"pageSize": 100, "page": page},
            )
            body = resp.json()
            assets.extend(body.get("data", []))
            if not body.get("hasNext", False):
                break
            page += 1
        return assets

    # -- hierarchy builders -------------------------------------------------

    def _build_site(self, site_id: str, site_name: str) -> SiteNode:
        """Build a SiteNode with its device children."""
        relations = self.get_relations(site_id, "ASSET")
        devices: list[DeviceNode] = []
        for rel in relations:
            child = rel["to"]
            if child["entityType"] == "DEVICE":
                dev = self.get_device(child["id"])
                devices.append(DeviceNode(id=child["id"], name=dev["name"]))
        return SiteNode(id=site_id, name=site_name, devices=devices)

    def _build_region(self, region_id: str, region_name: str) -> list[SiteNode]:
        """Build sites from a region's children."""
        relations = self.get_relations(region_id, "ASSET")
        sites: list[SiteNode] = []
        for rel in relations:
            child = rel["to"]
            if child["entityType"] == "ASSET":
                asset = self.get_asset(child["id"])
                if asset.get("type", "").lower() == "site":
                    sites.append(self._build_site(child["id"], asset["name"]))
        return sites

    def _build_estate(self, estate_id: str, estate_name: str) -> list[SiteNode]:
        """Build sites from an estate (estate → regions → sites)."""
        relations = self.get_relations(estate_id, "ASSET")
        sites: list[SiteNode] = []
        for rel in relations:
            child = rel["to"]
            if child["entityType"] == "ASSET":
                asset = self.get_asset(child["id"])
                child_type = asset.get("type", "").lower()
                if child_type == "region":
                    sites.extend(self._build_region(child["id"], asset["name"]))
                elif child_type == "site":
                    # Estate directly contains sites (no region level)
                    sites.append(self._build_site(child["id"], asset["name"]))
        return sites

    def resolve_hierarchy(self, entity_id: str, entity_type: str) -> HierarchyResult:
        """
        Resolve the full hierarchy from any starting point.

        Handles: CUSTOMER, or ASSET of type estate/region/site.
        Always returns a flat list of SiteNode in .sites[].
        """
        entity_type = entity_type.upper()

        if entity_type == "CUSTOMER":
            customer = self.get_customer(entity_id)
            name = customer["title"]
            # Customer → assets via assignment (not "Contains" relations)
            all_assets = self.get_customer_assets(entity_id)
            # Only traverse from top-level estates; regions/sites under
            # estates will be reached via Contains relations.
            estates = [a for a in all_assets if a.get("type", "").lower() == "estate"]
            sites: list[SiteNode] = []
            if estates:
                for est in estates:
                    eid = est["id"]["id"]
                    sites.extend(self._build_estate(eid, est["name"]))
            else:
                # No estates — try regions, then bare sites
                regions = [a for a in all_assets if a.get("type", "").lower() == "region"]
                if regions:
                    for reg in regions:
                        rid = reg["id"]["id"]
                        sites.extend(self._build_region(rid, reg["name"]))
                else:
                    bare_sites = [a for a in all_assets if a.get("type", "").lower() == "site"]
                    for s in bare_sites:
                        sid = s["id"]["id"]
                        sites.append(self._build_site(sid, s["name"]))
            return HierarchyResult(
                id=entity_id, name=name, entity_type="CUSTOMER",
                asset_type=None, sites=sites,
            )

        # ASSET — determine level from asset type
        asset = self.get_asset(entity_id)
        name = asset["name"]
        asset_type = asset.get("type", "").lower()

        if asset_type == "estate":
            sites = self._build_estate(entity_id, name)
        elif asset_type == "region":
            sites = self._build_region(entity_id, name)
        elif asset_type == "site":
            sites = [self._build_site(entity_id, name)]
        else:
            raise ValueError(f"Unknown asset type: {asset_type!r} for asset {entity_id}")

        return HierarchyResult(
            id=entity_id, name=name, entity_type="ASSET",
            asset_type=asset_type, sites=sites,
        )

    # -- telemetry ----------------------------------------------------------

    def get_telemetry_sum(
        self,
        device_id: str,
        key: str,
        start_ts: int,
        end_ts: int,
    ) -> float:
        """Return SUM aggregation of a telemetry key over [start_ts, end_ts]."""
        interval = end_ts - start_ts
        params = {
            "keys": key,
            "startTs": start_ts,
            "endTs": end_ts,
            "agg": "SUM",
            "interval": interval,
        }
        resp = self._request(
            "GET",
            f"/api/plugins/telemetry/DEVICE/{device_id}/values/timeseries",
            params=params,
        )
        data = resp.json()
        # Response: {"energy_wh": [{"ts": ..., "value": "123.45"}]}
        values = data.get(key, [])
        if not values:
            return 0.0
        try:
            return float(values[0]["value"])
        except (ValueError, KeyError, IndexError):
            return 0.0

    # -- alarms -------------------------------------------------------------

    def get_alarm_history(
        self,
        entity_id: str,
        entity_type: str,
        start_ts: int,
        end_ts: int,
        page_size: int = 100,
    ) -> list[dict]:
        """Return alarm records for an entity in the given time window."""
        alarms: list[dict] = []
        page = 0
        while True:
            params = {
                "startTime": start_ts,
                "endTime": end_ts,
                "pageSize": page_size,
                "page": page,
                "sortProperty": "createdTime",
                "sortOrder": "DESC",
            }
            resp = self._request(
                "GET",
                f"/api/alarm/{entity_type}/{entity_id}",
                params=params,
            )
            body = resp.json()
            batch = body.get("data", [])
            alarms.extend(batch)
            if not body.get("hasNext", False):
                break
            page += 1
        return alarms

    # -- device status ------------------------------------------------------

    def is_device_active(self, device_id: str, threshold_minutes: int = 10) -> bool:
        """Check if device was active within the last threshold_minutes."""
        params = {"keys": "lastActivityTime"}
        resp = self._request(
            "GET",
            f"/api/plugins/telemetry/DEVICE/{device_id}/values/attributes",
            params=params,
        )
        data = resp.json()
        # Response: [{"key": "lastActivityTime", "value": 1700000000000}]
        for attr in data:
            if attr.get("key") == "lastActivityTime":
                last_ts = attr["value"]
                now_ms = int(time.time() * 1000)
                return (now_ms - last_ts) < (threshold_minutes * 60 * 1000)
        return False

    # -- attributes ---------------------------------------------------------

    def get_attributes(
        self,
        entity_id: str,
        entity_type: str,
        scope: str,
        keys: list[str] | None = None,
    ) -> dict:
        """Return attributes as a {key: value} dict."""
        path = f"/api/plugins/telemetry/{entity_type}/{entity_id}/values/attributes/{scope}"
        params = {}
        if keys:
            params["keys"] = ",".join(keys)
        resp = self._request("GET", path, params=params)
        # Response: [{"key": "k", "value": "v", "lastUpdateTs": ...}, ...]
        return {item["key"]: item["value"] for item in resp.json()}

    def save_attribute(
        self,
        entity_id: str,
        entity_type: str,
        scope: str,
        attrs: dict,
    ) -> None:
        """Save attributes (POST JSON body)."""
        path = f"/api/plugins/telemetry/{entity_type}/{entity_id}/attributes/{scope}"
        self._request("POST", path, json=attrs)
