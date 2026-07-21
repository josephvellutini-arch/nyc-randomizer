"""Dataset configuration for the NYC Randomizer data pipeline.

Every dataset ID and field name below was verified against the live
NYC Open Data Socrata (SODA) API during development — see README for how
to re-verify if a dataset gets renamed/deprecated.
"""

try:
    # On Windows, Python's `requests`/urllib3 verify TLS against the bundled
    # certifi CA list, not the OS certificate store. If this machine has a
    # corporate proxy or antivirus doing TLS inspection with its own root CA
    # (trusted by Windows, invisible to certifi), plain requests calls fail
    # with SSLCertVerificationError even though curl/PowerShell work fine.
    # truststore makes Python's ssl module defer to the OS trust store instead.
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

SOCRATA_BASE = "https://data.cityofnewyork.us/resource/{id}.json"
PAGE_SIZE = 1000

# Normalizes each dataset's borough field to this canonical set.
BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "StatenIsland"]

# Per-dataset borough code -> canonical borough name
PARKS_BOROUGH_MAP = {
    "M": "Manhattan",
    "B": "Brooklyn",
    "Q": "Queens",
    "X": "Bronx",
    "R": "StatenIsland",
}

LANDMARK_BOROUGH_MAP = {
    "MN": "Manhattan",
    "BK": "Brooklyn",
    "QN": "Queens",
    "BX": "Bronx",
    "SI": "StatenIsland",
}

FULL_NAME_BOROUGH_MAP = {
    "Manhattan": "Manhattan",
    "Brooklyn": "Brooklyn",
    "Queens": "Queens",
    "Bronx": "Bronx",
    "Staten Island": "StatenIsland",
}

# Approximate bounding boxes (south, west, north, east) used for OpenStreetMap
# Overpass queries. Boxes overlap slightly at borough borders; that's fine —
# results are deduped by OSM id.
BOROUGH_BBOX = {
    "Manhattan": (40.6829, -74.0479, 40.8820, -73.9067),
    "Brooklyn": (40.5707, -74.0421, 40.7395, -73.8334),
    "Queens": (40.4961, -73.9626, 40.8007, -73.7004),
    "Bronx": (40.7855, -73.9339, 40.9153, -73.7654),
    "StatenIsland": (40.4960, -74.2557, 40.6514, -74.0522),
}

# NYC Open Data (Socrata) dataset definitions.
OPEN_DATA_DATASETS = {
    "parks": {
        "id": "enfh-gkve",
        "category": "park",
        "borough_field": "borough",
        "borough_map": PARKS_BOROUGH_MAP,
    },
    "landmarks": {
        "id": "buis-pvji",
        "category": "landmark",
        "borough_field": "borough",
        "borough_map": LANDMARK_BOROUGH_MAP,
    },
    "cultural_orgs": {
        "id": "u35m-9t32",
        "category": "museum",
        "borough_field": "borough",
        "borough_map": FULL_NAME_BOROUGH_MAP,
    },
    "restaurants": {
        "id": "43nn-pn8j",
        "category": "restaurant",
        "borough_field": "boro",
        "borough_map": FULL_NAME_BOROUGH_MAP,
    },
    "public_art": {
        "id": "2pg3-gcaa",
        "category": "public_art",
        "borough_field": "borough",
        "borough_map": FULL_NAME_BOROUGH_MAP,
    },
    "farmers_markets": {
        "id": "8vwk-6iz2",
        "category": "market",
        "borough_field": "borough",
        "borough_map": FULL_NAME_BOROUGH_MAP,
    },
}

# OpenStreetMap Overpass tags to supplement categories NYC Open Data covers
# thinly (cafes especially; some extra markets/art/museums too).
OSM_QUERIES = [
    {"tag": "amenity", "value": "cafe", "category": "cafe"},
    {"tag": "amenity", "value": "marketplace", "category": "market"},
    {"tag": "tourism", "value": "artwork", "category": "public_art"},
    {"tag": "tourism", "value": "museum", "category": "museum"},
]

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Category baseline scores (0-100) before designation/grade adjustments.
CATEGORY_BASELINE = {
    "park": 65,
    "landmark": 70,
    "museum": 60,
    "restaurant": 50,
    "cafe": 50,
    "public_art": 55,
    "market": 55,
}

EDITORIAL_BOOST_FILE = "editorial_boost.json"
# Lives inside site/ (not a separate top-level data/ folder) so a single
# static file server root serves both the app and its data — required for
# GitHub Pages, and for local testing to work without path traversal.
OUTPUT_FILE = "../site/data/venues.json"
