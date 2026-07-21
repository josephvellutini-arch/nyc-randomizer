"""Orchestrates the full data pipeline: fetch -> score -> write data/venues.json.

Run manually or on a schedule (not called by the live site per-request).
"""

import json
import os
from collections import Counter

from fetch_open_data import fetch_open_data_venues
from fetch_osm import fetch_osm_venues
from score import score_venues
from config import OUTPUT_FILE


def main():
    print("Fetching NYC Open Data...")
    venues = fetch_open_data_venues()

    print("\nFetching OpenStreetMap (Overpass)...")
    venues += fetch_osm_venues()

    print(f"\nScoring {len(venues)} venues...")
    venues = score_venues(venues)

    out_path = os.path.join(os.path.dirname(__file__), OUTPUT_FILE)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(venues, f, ensure_ascii=False)

    by_category = Counter(v["category"] for v in venues)
    by_borough = Counter(v["borough"] for v in venues)
    print(f"\nWrote {len(venues)} venues to {os.path.abspath(out_path)}")
    print("By category:", dict(by_category))
    print("By borough:", dict(by_borough))


if __name__ == "__main__":
    main()
