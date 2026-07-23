"""One-time fetch of NYC's neighborhood boundaries (2020 Neighborhood
Tabulation Areas) for the map view's neighborhood-highlight effect.

Not part of build.py/rescore.py — neighborhood shapes don't change, so this
only needs to be re-run if NYC revises the NTA boundaries. Output is a plain
GeoJSON FeatureCollection, consumable directly by Leaflet's L.geoJSON.
"""

import json
import os

import requests

from config import SOCRATA_BASE, PAGE_SIZE, NEIGHBORHOODS_DATASET_ID, NEIGHBORHOODS_OUTPUT_FILE


def fetch_neighborhoods():
    url = SOCRATA_BASE.format(id=NEIGHBORHOODS_DATASET_ID)
    rows = []
    offset = 0
    while True:
        resp = requests.get(
            url, params={"$limit": PAGE_SIZE, "$offset": offset}, timeout=30
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    features = []
    for row in rows:
        geometry = row.get("the_geom")
        name = row.get("ntaname")
        if not geometry or not name:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"name": name, "borough": row.get("boroname", "")},
                "geometry": geometry,
            }
        )

    return {"type": "FeatureCollection", "features": features}


if __name__ == "__main__":
    geojson = fetch_neighborhoods()
    out_path = os.path.join(os.path.dirname(__file__), NEIGHBORHOODS_OUTPUT_FILE)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    print(f"Wrote {len(geojson['features'])} neighborhoods to {os.path.abspath(out_path)}")
