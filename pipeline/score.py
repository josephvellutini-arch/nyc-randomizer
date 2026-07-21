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

Each venue gets a `score` (0-100), a `score_label` (human-readable tier), and
a `score_breakdown` (list of the components that produced the score) so the
number isn't just an opaque heuristic — see the frontend's "why this score"
display.

This is a v1 heuristic. Once the site has real visitors, the natural next
step is to replace/augment this with actual user ratings collected on-site
(e.g. a Beli-style pairwise comparison ranking), which needs no third-party
data at all.
"""

import json
import os

from config import CATEGORY_BASELINE, EDITORIAL_BOOST_FILE

GRADE_ADJUSTMENT = {
    "A": 25,
    "B": 10,
    "C": -15,
}

GRADE_DESCRIPTION = {
    "A": "DOHMH inspection grade A",
    "B": "DOHMH inspection grade B",
    "C": "DOHMH inspection grade C",
}

SCORE_LABELS = [
    (80, "Exceptional"),
    (65, "Highly Recommended"),
    (50, "Worth a Visit"),
    (0, "Limited Info / Mixed Signals"),
]


def _load_editorial_boosts():
    path = os.path.join(os.path.dirname(__file__), EDITORIAL_BOOST_FILE)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _label_for(score):
    for threshold, label in SCORE_LABELS:
        if score >= threshold:
            return label
    return SCORE_LABELS[-1][1]


def _score_one(venue, editorial_boosts):
    breakdown = []

    baseline = CATEGORY_BASELINE.get(venue["category"], 50)
    breakdown.append({"label": f"Baseline for {venue['category']}", "delta": baseline})
    total = baseline

    if venue["category"] == "restaurant":
        grade = venue.get("meta", {}).get("grade", "")
        adjustment = GRADE_ADJUSTMENT.get(grade, 0)
        if adjustment:
            breakdown.append({"label": GRADE_DESCRIPTION[grade], "delta": adjustment})
            total += adjustment

    boost = editorial_boosts.get(venue["id"], 0)
    if boost:
        breakdown.append({"label": "Editorial boost", "delta": boost})
        total += boost

    total = max(0, min(100, round(total)))
    return total, breakdown


def score_venues(venues):
    """Mutates and returns venues with `score`, `score_label`, and
    `score_breakdown` fields added."""
    editorial_boosts = _load_editorial_boosts()
    for venue in venues:
        total, breakdown = _score_one(venue, editorial_boosts)
        venue["score"] = total
        venue["score_label"] = _label_for(total)
        venue["score_breakdown"] = breakdown
    return venues
