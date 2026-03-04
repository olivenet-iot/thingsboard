"""Simple in-memory TTL cache for hierarchy, device, and asset lookups."""

from __future__ import annotations

import time

# ---------------------------------------------------------------------------
# Hierarchy cache (customer_id → full hierarchy dict)
# ---------------------------------------------------------------------------

_hierarchy_cache: dict[str, tuple[dict, float]] = {}
HIERARCHY_TTL = 300  # 5 minutes


def get_cached_hierarchy(customer_id: str) -> dict | None:
    """Return cached hierarchy for *customer_id*, or None if expired/missing."""
    entry = _hierarchy_cache.get(customer_id)
    if entry and (time.time() - entry[1]) < HIERARCHY_TTL:
        return entry[0]
    return None


def set_cached_hierarchy(customer_id: str, data: dict) -> None:
    """Store hierarchy data with current timestamp."""
    _hierarchy_cache[customer_id] = (data, time.time())


# ---------------------------------------------------------------------------
# Entity cache (device / asset lookups)
# ---------------------------------------------------------------------------

_entity_cache: dict[str, tuple[dict, float]] = {}
ENTITY_TTL = 60  # 1 minute


def get_cached_entity(entity_id: str) -> dict | None:
    """Return cached entity (device or asset), or None if expired/missing."""
    entry = _entity_cache.get(entity_id)
    if entry and (time.time() - entry[1]) < ENTITY_TTL:
        return entry[0]
    return None


def set_cached_entity(entity_id: str, data: dict) -> None:
    """Store entity data with current timestamp."""
    _entity_cache[entity_id] = (data, time.time())


# ---------------------------------------------------------------------------
# Hierarchy membership helpers (for customer isolation)
# ---------------------------------------------------------------------------

def get_hierarchy_entity_ids(customer_id: str) -> set[str] | None:
    """Return all device + asset IDs from the cached hierarchy, or None."""
    hierarchy = get_cached_hierarchy(customer_id)
    if hierarchy is None:
        return None

    ids: set[str] = set()
    _collect_ids(hierarchy, ids)
    return ids


def _collect_ids(node: dict, ids: set[str]) -> None:
    """Recursively collect all 'id' fields and device IDs from hierarchy."""
    if "customer_id" in node:
        ids.add(node["customer_id"])
    if "id" in node and isinstance(node["id"], str):
        ids.add(node["id"])

    for key in ("estates", "regions", "sites", "devices"):
        for child in node.get(key, []):
            if isinstance(child, dict):
                _collect_ids(child, ids)
