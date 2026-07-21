"""Fetches supplemental venue data from OpenStreetMap (Overpass API).

NYC Open Data covers parks/landmarks/restaurants/public art/farmers markets
well, but has no good source for cafes specifically, and is thin on
independent museums and additional public art/markets. OSM data is
ODbL-licensed (open, attribution required — see README).
"""

import time

import requests

from config import OVERPASS_URL, OSM_QUERIES, BOROUGH_BBOX

# overpass-api.de returns 406 Not Acceptable for requests without a
# descriptive User-Agent (its usage policy asks for one identifying the app).
HEADERS = {"User-Agent": "NYC-Randomizer/0.1 (personal project; contact: josephvellutini@gmail.com)"}


def _build_query(bbox, tag, value):
    south, west, north, east = bbox
    bbox_str = f"{south},{west},{north},{east}"
    body = (
        f'node["{tag}"="{value}"]({bbox_str});\n'
        f'way["{tag}"="{value}"]({bbox_str});'
    )
    return f"[out:json][timeout:60];\n(\n{body}\n);\nout center;"


def _normalize_element(element, borough, category):
    tags = element.get("tags", {})
    name = tags.get("name")
    if not name:
        return None
    if element["type"] == "node":
        lat, lng = element.get("lat"), element.get("lon")
    else:
        center = element.get("center") or {}
        lat, lng = center.get("lat"), center.get("lon")
    if lat is None or lng is None:
        return None
    addr_parts = [tags.get("addr:housenumber", ""), tags.get("addr:street", "")]
    address = " ".join(p for p in addr_parts if p)
    return {
        "id": f"osm:{element['type']}/{element['id']}",
        "name": name,
        "category": category,
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": address,
        "source": "openstreetmap",
        "meta": {},
    }


def _query_with_retries(query, max_attempts=5):
    """The free public Overpass instance frequently 504s/429s under load.
    Retry with exponential backoff. Returns None (rather than raising) if
    every attempt fails — a transient outage on one (borough, tag) query
    shouldn't blow up the whole pipeline run."""
    resp = None
    for attempt in range(max_attempts):
        resp = requests.post(
            OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=90
        )
        if resp.status_code == 200:
            return resp
        wait = 5 * (2 ** attempt)
        print(f"    got {resp.status_code}, retrying in {wait}s...")
        time.sleep(wait)
    print(f"    giving up after {max_attempts} attempts (last status {resp.status_code}) — skipping")
    return None


def fetch_osm_venues():
    """Query Overpass once per (borough, tag) pair — smaller queries are far
    less likely to hit the shared instance's gateway timeout than one big
    combined query per borough. Results deduped by OSM type/id. Queries that
    fail all retries are skipped (logged), not fatal."""
    venues = {}
    skipped = []
    for borough, bbox in BOROUGH_BBOX.items():
        for q in OSM_QUERIES:
            query = _build_query(bbox, q["tag"], q["value"])
            print(f"  {borough} / {q['category']}...")
            resp = _query_with_retries(query)
            if resp is None:
                skipped.append(f"{borough}/{q['category']}")
                continue
            elements = resp.json().get("elements", [])
            kept = 0
            for element in elements:
                venue = _normalize_element(element, borough, q["category"])
                if venue:
                    venues[venue["id"]] = venue
                    kept += 1
            print(f"    {kept}/{len(elements)} elements kept")
            # The first run of this pipeline hit real 429s from the free
            # public Overpass instance at a 2s spacing, not just server-side
            # 504 overload — 5s is a better-behaved default.
            time.sleep(5)
    if skipped:
        print(f"  Skipped after repeated failures: {', '.join(skipped)}")
    return list(venues.values())


if __name__ == "__main__":
    result = fetch_osm_venues()
    print(f"Total OSM venues: {len(result)}")
