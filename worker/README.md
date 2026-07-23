# Ratings proxy (Cloudflare Worker)

Keeps the Yelp/Google API keys off the client. The static site calls this
Worker per venue shown in a generated itinerary; it calls Yelp + Google
server-side and returns just the numbers.

## Deploy

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**
2. Name it (e.g. `nyc-randomizer-ratings`), deploy the placeholder, then **Edit code**
3. Delete the placeholder and paste in the entire contents of `ratings-proxy.js`
4. **Save and deploy**
5. Go to the Worker's **Settings → Variables and Secrets**, add three, all as **Secret** (encrypted) type:
   - `YELP_API_KEY`
   - `GOOGLE_PLACES_API_KEY`
   - `ALLOWED_ORIGIN` — set to `https://josephvellutini-arch.github.io`
6. Note the Worker's URL, shown at the top of its dashboard page — looks like
   `https://nyc-randomizer-ratings.<your-subdomain>.workers.dev`

## Request format

```
GET /?name=LOOSIE%27S&address=145%20BOWERY&borough=Manhattan
```

Response:

```json
{
  "yelp": { "rating": 4.5, "review_count": 393, "url": "https://www.yelp.com/biz/..." },
  "google": { "rating": 4.6, "review_count": 812, "url": "https://maps.google.com/?..." }
}
```

Either field is `null` if that provider has no match or the call failed —
the frontend should handle a missing provider gracefully (just show what's
available).

## Current abuse protection (honest limits)

- CORS restricted to `ALLOWED_ORIGIN`, so browser JS on other sites can't
  read responses from this Worker.
- This does **not** stop someone from calling the Worker URL directly
  (curl, Postman, etc.) — CORS only constrains browsers. For this project's
  scale (personal, low traffic), the real financial safety net is the
  Google Cloud **budget alert** set up alongside the API key, not this
  Worker's own defenses.
- If this ever needs tightening: add a per-IP rate limit inside the Worker,
  or a shared request token that `app.js` sends and the Worker checks
  (raises the bar, doesn't make it airtight — a client-side secret is
  never fully hideable).
