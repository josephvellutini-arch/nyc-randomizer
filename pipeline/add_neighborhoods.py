"""One-time enrichment: tags each venue in docs/data/venues.json with its
containing neighborhood (NTA name), via point-in-polygon lookup against
docs/data/neighborhoods.json. Run after build.py/rescore.py, not part of
the regular fetch cycle -- neighborhood shapes don't change.
"""

import json
import os

from shapely.geometry import shape, Point
from shapely.strtree import STRtree

from config import OUTPUT_FILE, NEIGHBORHOODS_OUTPUT_FILE


def load_neighborhoods():
    path = os.path.join(os.path.dirname(__file__), NEIGHBORHOODS_OUTPUT_FILE)
    with open(path, "r", encoding="utf-8") as f:
        geojson = json.load(f)
    geometries = []
    names = []
    for feature in geojson["features"]:
        geometries.append(shape(feature["geometry"]))
        names.append(feature["properties"]["name"])
    return geometries, names


def tag_venue(point, geometries, names, tree):
    candidate_indices = tree.query(point)
    for idx in candidate_indices:
        if geometries[idx].contains(point):
            return names[idx], False
    # Fallback: point didn't fall strictly inside any polygon (pier,
    # waterfront edge, minor geocoding imprecision) -- use nearest instead
    # of leaving it untagged.
    nearest_idx = tree.nearest(point)
    return names[nearest_idx], True


def main():
    geometries, names = load_neighborhoods()
    tree = STRtree(geometries)

    venues_path = os.path.join(os.path.dirname(__file__), OUTPUT_FILE)
    with open(venues_path, "r", encoding="utf-8") as f:
        venues = json.load(f)

    unmatched = 0
    for venue in venues:
        point = Point(venue["lng"], venue["lat"])
        neighborhood, used_fallback = tag_venue(point, geometries, names, tree)
        venue["neighborhood"] = neighborhood
        if used_fallback:
            unmatched += 1

    with open(venues_path, "w", encoding="utf-8") as f:
        json.dump(venues, f, ensure_ascii=False)

    print(f"Tagged {len(venues)} venues with neighborhoods ({unmatched} used nearest-fallback)")


if __name__ == "__main__":
    main()
