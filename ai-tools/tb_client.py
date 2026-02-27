"""Async ThingsBoard REST API client using httpx."""

from __future__ import annotations

import logging

import httpx

from config import TB_URL, TB_USERNAME, TB_PASSWORD

logger = logging.getLogger(__name__)


class TBClient:
    """Async wrapper around the ThingsBoard REST API.

    Handles JWT authentication with automatic refresh on 401.
    """

    def __init__(
        self,
        base_url: str = TB_URL,
        username: str = TB_USERNAME,
        password: str = TB_PASSWORD,
    ):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.token: str | None = None
        self.refresh_token: str | None = None
        self.client = httpx.AsyncClient(timeout=30.0)

    # -- lifecycle ----------------------------------------------------------

    async def close(self) -> None:
        await self.client.aclose()

    # -- auth ---------------------------------------------------------------

    async def authenticate(self) -> str:
        """Obtain a JWT and store it for subsequent requests."""
        resp = await self.client.post(
            f"{self.base_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
        )
        resp.raise_for_status()
        data = resp.json()
        self.token = data["token"]
        self.refresh_token = data.get("refreshToken")
        return self.token

    def _auth_headers(self) -> dict[str, str]:
        return {"X-Authorization": f"Bearer {self.token}"} if self.token else {}

    # -- generic request wrapper --------------------------------------------

    async def _request(
        self, method: str, path: str, **kwargs
    ) -> httpx.Response:
        """Execute a request; re-authenticate once on 401."""
        if self.token is None:
            await self.authenticate()

        url = f"{self.base_url}{path}"
        resp = await self.client.request(
            method, url, headers=self._auth_headers(), **kwargs
        )

        if resp.status_code == 401:
            logger.info("JWT expired — re-authenticating")
            await self.authenticate()
            resp = await self.client.request(
                method, url, headers=self._auth_headers(), **kwargs
            )

        resp.raise_for_status()
        return resp

    # -- entity lookups -----------------------------------------------------

    async def get_asset(self, asset_id: str) -> dict:
        return (await self._request("GET", f"/api/asset/{asset_id}")).json()

    async def get_device(self, device_id: str) -> dict:
        return (await self._request("GET", f"/api/device/{device_id}")).json()

    async def get_customer(self, customer_id: str) -> dict:
        return (await self._request("GET", f"/api/customer/{customer_id}")).json()

    # -- relations ----------------------------------------------------------

    async def get_entity_relations(
        self, entity_id: str, entity_type: str
    ) -> list[dict]:
        """Return 'Contains' relations from the given entity."""
        params = {
            "fromId": entity_id,
            "fromType": entity_type,
            "relationType": "Contains",
            "relationTypeGroup": "COMMON",
        }
        return (await self._request("GET", "/api/relations", params=params)).json()

    async def get_customer_assets(
        self, customer_id: str, asset_type: str | None = None
    ) -> list[dict]:
        """Return all assets assigned to a customer (paginated)."""
        assets: list[dict] = []
        page = 0
        while True:
            params: dict = {"pageSize": 100, "page": page}
            if asset_type:
                params["type"] = asset_type
            resp = await self._request(
                "GET",
                f"/api/customer/{customer_id}/assets",
                params=params,
            )
            body = resp.json()
            assets.extend(body.get("data", []))
            if not body.get("hasNext", False):
                break
            page += 1
        return assets

    # -- telemetry ----------------------------------------------------------

    async def get_latest_telemetry(
        self, entity_type: str, entity_id: str, keys: list[str]
    ) -> dict[str, float | str]:
        """Return the most recent value for each telemetry key.

        Returns {key: value} with values parsed to float where possible.
        """
        params = {"keys": ",".join(keys)}
        resp = await self._request(
            "GET",
            f"/api/plugins/telemetry/{entity_type}/{entity_id}/values/timeseries",
            params=params,
        )
        raw = resp.json()
        result: dict[str, float | str] = {}
        for key in keys:
            values = raw.get(key, [])
            if values:
                v = values[0].get("value", "")
                try:
                    result[key] = float(v)
                except (ValueError, TypeError):
                    result[key] = v
        return result

    async def get_historical_telemetry(
        self,
        entity_type: str,
        entity_id: str,
        keys: list[str],
        start_ts: int,
        end_ts: int,
        agg: str = "SUM",
        interval: int | None = None,
    ) -> dict[str, list[dict]]:
        """Return aggregated telemetry over a time range.

        When *interval* is ``None`` the entire range is used as a single
        bucket (returns one value per key).
        """
        if interval is None:
            interval = end_ts - start_ts

        params = {
            "keys": ",".join(keys),
            "startTs": start_ts,
            "endTs": end_ts,
            "agg": agg,
            "interval": interval,
            "limit": 10000,
        }
        resp = await self._request(
            "GET",
            f"/api/plugins/telemetry/{entity_type}/{entity_id}/values/timeseries",
            params=params,
        )
        raw = resp.json()
        result: dict[str, list[dict]] = {}
        for key in keys:
            buckets = raw.get(key, [])
            parsed: list[dict] = []
            for b in buckets:
                try:
                    parsed.append({"ts": b["ts"], "value": float(b["value"])})
                except (ValueError, KeyError, TypeError):
                    continue
            parsed.sort(key=lambda x: x["ts"])
            result[key] = parsed
        return result

    # -- attributes ---------------------------------------------------------

    async def get_attributes(
        self,
        entity_type: str,
        entity_id: str,
        scope: str = "SERVER_SCOPE",
        keys: list[str] | None = None,
    ) -> dict:
        """Return attributes as a {key: value} dict."""
        path = (
            f"/api/plugins/telemetry/{entity_type}/{entity_id}"
            f"/values/attributes/{scope}"
        )
        params = {}
        if keys:
            params["keys"] = ",".join(keys)
        resp = await self._request("GET", path, params=params)
        return {item["key"]: item["value"] for item in resp.json()}

    # -- alarms -------------------------------------------------------------

    async def get_alarms(
        self,
        entity_type: str | None = None,
        entity_id: str | None = None,
        status: str = "ACTIVE",
        page_size: int = 100,
    ) -> list[dict]:
        """Return alarms for an entity or tenant-wide."""
        alarms: list[dict] = []
        page = 0
        while True:
            params: dict = {
                "pageSize": page_size,
                "page": page,
                "sortProperty": "createdTime",
                "sortOrder": "DESC",
            }
            if status and status != "ANY":
                params["searchStatus"] = status

            if entity_type and entity_id:
                path = f"/api/alarm/{entity_type}/{entity_id}"
            else:
                path = "/api/alarms"

            resp = await self._request("GET", path, params=params)
            body = resp.json()
            alarms.extend(body.get("data", []))
            if not body.get("hasNext", False):
                break
            page += 1
        return alarms

    # -- RPC ----------------------------------------------------------------

    async def send_rpc(
        self, device_id: str, method: str, params: dict | None = None
    ) -> dict | None:
        """Send a one-way RPC command to a device."""
        body = {"method": method, "params": params or {}}
        resp = await self._request(
            "POST", f"/api/rpc/oneway/{device_id}", json=body
        )
        if resp.content:
            return resp.json()
        return None

    # -- connectivity check -------------------------------------------------

    async def check_connectivity(self) -> bool:
        """Return True if we can reach the TB API."""
        try:
            if self.token is None:
                await self.authenticate()
            resp = await self.client.get(
                f"{self.base_url}/api/auth/user",
                headers=self._auth_headers(),
            )
            return resp.status_code == 200
        except Exception:
            return False
