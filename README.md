# NYC Randomizer

Hi, my name is Joey, and I've been living in NYC since 2024. I love this city, but I don't feel like I make the most of my time here — with so much beauty and diversity packed into five boroughs, I often end up with choice overload and default to exploring only the places I already know.

Here's my solution: the NYC Randomizer.

Pick a borough (or all of NYC), pick categories, and get a randomized itinerary of
restaurants, cafes, parks, landmarks, museums, public art, and markets — ranked by
a proprietary quality score built from open data.

Ratings are **not** scraped or blended from Yelp/Google/TripAdvisor/Apple — sadly, every
major review provider's API terms forbid combining their rating data with other
sources or caching it long-term. Instead, venue data and scoring come from:

- [NYC Open Data](https://opendata.cityofnewyork.us/) (Socrata API) — parks,
  individual landmarks, DCLA-funded cultural organizations, restaurant
  inspections, public art, farmers markets
- [OpenStreetMap](https://www.openstreetmap.org/) (Overpass API, ODbL —
  attribution required) — supplements cafes, museums, public art, markets

## Project layout

- `pipeline/` — Python data pipeline. Run `python pipeline/build.py` to fetch,
  score, and merge venue data into `docs/data/venues.json`.
- `docs/data/venues.json` — generated output consumed by the site. Not
  hand-edited (except `pipeline/editorial_boost.json`, see below). Lives
  inside `docs/` (not a separate top-level `data/`) so one static file server
  root can serve both the app and its data — `docs/` specifically because
  that's one of the two folders GitHub Pages can serve without a custom
  Actions workflow (the other being the repo root).
- `docs/` — static frontend (`index.html`, `app.js`, `style.css`). No build step;
  serve with any static file server. Also the live GitHub Pages site.

## Running the pipeline

```
pip install -r pipeline/requirements.txt
python pipeline/build.py
```

## Running the site locally

```
python -m http.server --directory docs 8000
```

Then open http://localhost:8000

## Editorial boosts

`pipeline/editorial_boost.json` lets you hand-boost specific venues by ID —
this is your own opinion, not scraped review content, so it carries no API ToS
risk. Edit it and re-run the pipeline to apply.

## AI use disclosure

**Level: AI-generated, human-directed.** The data pipeline, scoring model, and
frontend in this repo were written by Claude Code (Anthropic), an AI coding
assistant. Joey set the goal and requirements, made the key decisions (data
strategy, category scope, tech stack, hosting), tested the running site, and
wrote the personal introduction above; Claude wrote the code and this
documentation under that direction.

Every commit Claude authored carries a `Co-Authored-By: Claude` trailer in the
git history, so the AI-authored portions are traceable commit-by-commit rather
than just asserted here.
