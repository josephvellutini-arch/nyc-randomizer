# NYC Randomizer
Hi my name is Joey and I have been living in NYC since 2024. I love NYC but I don't make enough of my time here. With such a beautiful and diverse city, I often find myself with choice overload and end up only exploring the places I know. 

Here is my solution: The NYC Randomizer

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
  score, and merge venue data into `site/data/venues.json`.
- `site/data/venues.json` — generated output consumed by the site. Not
  hand-edited (except `pipeline/editorial_boost.json`, see below). Lives
  inside `site/` (not a separate top-level `data/`) so one static file server
  root can serve both the app and its data — required for GitHub Pages.
- `site/` — static frontend (`index.html`, `app.js`, `style.css`). No build step;
  serve with any static file server.

## Running the pipeline

```
pip install -r pipeline/requirements.txt
python pipeline/build.py
```

## Running the site locally

```
python -m http.server --directory site 8000
```

Then open http://localhost:8000

## Editorial boosts

`pipeline/editorial_boost.json` lets you hand-boost specific venues by ID —
this is your own opinion, not scraped review content, so it carries no API ToS
risk. Edit it and re-run the pipeline to apply.
