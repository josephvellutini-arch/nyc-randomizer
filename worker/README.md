# Ratings proxy (Cloudflare Worker)

Keeps the Google Places API key off the client. The static site calls this
Worker per venue shown in a generated itinerary; it calls Google server-side
and returns just the number. (Originally showed Yelp + Google separately;
simplified to Google-only — see the comment at the top of `ratings-proxy.js`.)

## Deploy

Uses Wrangler (Cloudflare's CLI), not the dashboard's code editor — the
dashboard's "Quick Edit" flow silently failed to deploy pasted changes
multiple times during development with no clear error.

```
npm install -g wrangler
wrangler login          # one-time interactive browser auth
cd worker
wrangler deploy
```

One-time setup for a fresh environment (already done for the current
deployment):

```
wrangler kv namespace create RATINGS_RATE_LIMIT   # then add the printed
                                                    # binding to wrangler.toml

wrangler secret put GOOGLE_PLACES_API_KEY
wrangler secret put ALLOWED_ORIGIN                 # e.g. https://josephvellutini-arch.github.io
wrangler secret put APP_TOKEN                       # any random string; must match APP_TOKEN in docs/app.js
```

If `wrangler secret put` ever appears to silently not take effect after a
redeploy, check for response caching before assuming the secret is wrong —
see the note in `ratings-proxy.js` about `Cache-Control: no-store`; an
earlier debugging session lost significant time to Cloudflare's edge
caching an old response rather than an actual secret/encoding bug.

## Request format

```
GET /?name=LOOSIE%27S&address=145%20BOWERY
Header: X-App-Token: <matches the Worker's APP_TOKEN secret>
```

Response:

```json
{
  "google": { "rating": 4.6, "review_count": 812, "url": "https://maps.google.com/?..." }
}
```

`google` is `null` if there's no match or the call failed — the frontend
handles a missing result gracefully (just shows nothing for that venue).

## Abuse protection

- **`X-App-Token` header check**: the Worker rejects requests missing the
  correct token with 401. Not a real secret (it's in public JS, so anyone
  can read it) — just raises the bar against casual scanning of the Worker's
  URL by things that never load the actual page.
- **Per-IP rate limiting via KV** (`RATINGS_RATE_LIMIT` binding, 30
  requests/60s per `CF-Connecting-IP`): the actual protection against
  sustained abuse/cost exposure, independent of whether the token leaks.
- **CORS** restricted to `ALLOWED_ORIGIN`.
- The Google API key itself cannot be usefully IP-restricted — Cloudflare
  Workers egress from a large, dynamic, shared IP pool, so an IP allowlist
  would restrict essentially nothing. Real defenses on the Google side are
  the key's API-scope restriction (Places API only) and a Google Cloud
  budget alert.
