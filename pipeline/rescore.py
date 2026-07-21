"""Re-applies scoring to the existing docs/data/venues.json without
re-fetching from NYC Open Data/OpenStreetMap.

Useful whenever score.py changes but the underlying venue data hasn't —
avoids unnecessary load on those free APIs. Run the full build.py instead
when you actually need fresh venue data.
"""

import json
import os

from score import score_venues
from config import OUTPUT_FILE


def main():
    out_path = os.path.join(os.path.dirname(__file__), OUTPUT_FILE)
    with open(out_path, "r", encoding="utf-8") as f:
        venues = json.load(f)

    for venue in venues:
        venue.pop("review_links", None)  # now built client-side, see docs/app.js

    venues = score_venues(venues)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(venues, f, ensure_ascii=False)

    print(f"Rescored {len(venues)} venues in place at {os.path.abspath(out_path)}")


if __name__ == "__main__":
    main()
