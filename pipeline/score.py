"""Proprietary venue scoring.

Deliberately does NOT touch any third-party review/rating API — see
README and the project's data-strategy notes for why. Score is built purely
from open, unrestricted signals:

  - a per-category baseline (landmarks/parks are inherently higher-interest
    than an arbitrary restaurant)
  - restaurant inspection grade (DOHMH A/B/C), as a legitimate public-safety
    quality signal
  - an optional owner-curated `editorial_boost.json` (your own opinion, not
    scraped content, so no ToS exposure)

This is a v1 heuristic. Once the site has real visitors, the natural next
step is to replace/augment this with actual user ratings collected on-site.
"""

import json
import os

from config import CATEGORY_BASELINE, EDITORIAL_BOOST_FILE

GRADE_ADJUSTMENT = {
    "A": 25,
    "B": 10,
    "C": -15,
}


def _load_editorial_boosts():
    path = os.path.join(os.path.dirname(__file__), EDITORIAL_BOOST_FILE)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _score_one(venue, editorial_boosts):
    score = CATEGORY_BASELINE.get(venue["category"], 50)

    if venue["category"] == "restaurant":
        grade = venue.get("meta", {}).get("grade", "")
        score += GRADE_ADJUSTMENT.get(grade, 0)

    boost = editorial_boosts.get(venue["id"], 0)
    score += boost

    return max(0, min(100, round(score)))


def score_venues(venues):
    """Mutates and returns venues with a `score` field (0-100) added."""
    editorial_boosts = _load_editorial_boosts()
    for venue in venues:
        venue["score"] = _score_one(venue, editorial_boosts)
    return venues
