"""Fetches venue data from NYC Open Data (Socrata SODA API) and normalizes it
into the project's common venue schema:

    {id, name, category, borough, lat, lng, address, source, meta}

`meta` carries source-specific extras (e.g. restaurant inspection grade,
landmark designation type) that score.py reads but the frontend ignores.
"""

import requests

from config import SOCRATA_BASE, PAGE_SIZE, OPEN_DATA_DATASETS


def _fetch_all(dataset_id):
    """Paginate through a Socrata dataset and return all rows as dicts."""
    url = SOCRATA_BASE.format(id=dataset_id)
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
    return rows


def _borough(row, dataset_cfg):
    raw = row.get(dataset_cfg["borough_field"])
    if not raw:
        return None
    return dataset_cfg["borough_map"].get(raw)


def _safe_coords(lat, lng):
    """NYC Open Data has occasional malformed lat/lng strings (stray commas,
    whitespace). Returns (lat, lng) as floats, or (None, None) if unparsable."""
    if not lat or not lng:
        return None, None
    try:
        return float(str(lat).strip().rstrip(",")), float(str(lng).strip().rstrip(","))
    except ValueError:
        return None, None


def _polygon_centroid(multipolygon):
    """Rough centroid: mean of every vertex in the outer ring(s).

    Good enough for itinerary display; not a true area-weighted centroid.
    """
    coords = multipolygon.get("coordinates", [])
    points = []

    def collect(node):
        if not node:
            return
        if isinstance(node[0], (int, float)):
            points.append(node)
        else:
            for child in node:
                collect(child)

    collect(coords)
    if not points:
        return None, None
    lng = sum(p[0] for p in points) / len(points)
    lat = sum(p[1] for p in points) / len(points)
    return lat, lng


def _normalize_parks(row, dataset_cfg):
    borough = _borough(row, dataset_cfg)
    if not borough:
        return None
    multipolygon = row.get("multipolygon")
    if not multipolygon:
        return None
    lat, lng = _polygon_centroid(multipolygon)
    if lat is None:
        return None
    name = row.get("name311") or row.get("signname")
    if not name:
        return None
    return {
        "id": "parks:" + row.get("globalid", row.get("objectid", name)),
        "name": name,
        "category": "park",
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": row.get("address", ""),
        "source": "nyc_open_data:parks_properties",
        "meta": {"subcategory": row.get("subcategory", "")},
    }


def _normalize_landmarks(row, dataset_cfg):
    borough = _borough(row, dataset_cfg)
    if not borough:
        return None
    lat, lng = _safe_coords(row.get("latitude"), row.get("longitude"))
    if lat is None:
        return None
    name = row.get("lpc_name")
    if not name:
        return None
    return {
        "id": "landmarks:" + row.get("lpc_lpnumb", name),
        "name": name,
        "category": "landmark",
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": row.get("address", ""),
        "source": "nyc_open_data:individual_landmark_sites",
        "meta": {"landmark_type": row.get("landmarkty", "")},
    }


def _normalize_cultural_orgs(row, dataset_cfg):
    borough = _borough(row, dataset_cfg)
    if not borough:
        return None
    lat, lng = _safe_coords(row.get("latitude"), row.get("longitude"))
    if lat is None:
        return None
    name = row.get("organization_name")
    if not name:
        return None
    return {
        "id": "cultural_orgs:" + name + ":" + row.get("postcode", ""),
        "name": name,
        "category": "museum",
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": row.get("address", ""),
        "source": "nyc_open_data:dcla_cultural_organizations",
        "meta": {"discipline": row.get("discipline", "")},
    }


def _normalize_restaurants(row, dataset_cfg):
    borough = _borough(row, dataset_cfg)
    if not borough:
        return None
    lat, lng = _safe_coords(row.get("latitude"), row.get("longitude"))
    if lat is None:
        return None
    name = row.get("dba")
    if not name:
        return None
    address = " ".join(
        part
        for part in [row.get("building", ""), row.get("street", "")]
        if part
    )
    return {
        "id": "restaurants:" + row.get("camis", name),
        "name": name,
        "category": "restaurant",
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": address,
        "source": "nyc_open_data:dohmh_restaurant_inspections",
        "meta": {"grade": row.get("grade", ""), "inspection_date": row.get("inspection_date", "")},
    }


def _normalize_public_art(row, dataset_cfg):
    borough = _borough(row, dataset_cfg)
    if not borough:
        return None
    lat, lng = _safe_coords(row.get("latitude"), row.get("longitude"))
    if lat is None:
        return None
    name = row.get("title") or row.get("location_name")
    if not name:
        return None
    return {
        "id": "public_art:" + name + ":" + row.get("address", ""),
        "name": name,
        "category": "public_art",
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": row.get("address", row.get("location_name", "")),
        "source": "nyc_open_data:pdc_public_art_inventory",
        "meta": {"artwork_type": row.get("artwork_type1", "")},
    }


def _normalize_farmers_markets(row, dataset_cfg):
    borough = _borough(row, dataset_cfg)
    if not borough:
        return None
    lat, lng = _safe_coords(row.get("latitude"), row.get("longitude"))
    if lat is None:
        return None
    name = row.get("marketname")
    if not name:
        return None
    return {
        "id": "farmers_markets:" + name + ":" + row.get("streetaddress", ""),
        "name": name,
        "category": "market",
        "borough": borough,
        "lat": lat,
        "lng": lng,
        "address": row.get("streetaddress", ""),
        "source": "nyc_open_data:nyc_farmers_markets",
        "meta": {"days": row.get("daysoperation", "")},
    }


_NORMALIZERS = {
    "parks": _normalize_parks,
    "landmarks": _normalize_landmarks,
    "cultural_orgs": _normalize_cultural_orgs,
    "restaurants": _normalize_restaurants,
    "public_art": _normalize_public_art,
    "farmers_markets": _normalize_farmers_markets,
}


def fetch_open_data_venues():
    """Fetch and normalize every configured NYC Open Data dataset.

    Returns a list of venue dicts, deduped by id. Restaurant inspections has
    one row per inspection visit (same restaurant appears many times), so
    rows are sorted newest-first before dedup to keep each restaurant's most
    recent inspection (and its grade) rather than an arbitrary one.
    """
    venues = {}
    for key, dataset_cfg in OPEN_DATA_DATASETS.items():
        normalize = _NORMALIZERS[key]
        rows = _fetch_all(dataset_cfg["id"])
        if key == "restaurants":
            rows.sort(key=lambda r: r.get("inspection_date", ""), reverse=True)
        kept = 0
        for row in rows:
            venue = normalize(row, dataset_cfg)
            if venue:
                venues.setdefault(venue["id"], venue)
                kept += 1
        print(f"  {key}: {kept}/{len(rows)} rows kept ({len(venues)} unique venues so far)")
    return list(venues.values())


if __name__ == "__main__":
    result = fetch_open_data_venues()
    print(f"Total NYC Open Data venues: {len(result)}")
