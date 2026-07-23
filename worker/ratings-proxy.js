/**
 * NYC Randomizer — live ratings proxy (Cloudflare Worker).
 *
 * Keeps the Yelp/Google API keys server-side. The static site (docs/app.js)
 * calls this Worker per venue shown in a generated itinerary; this Worker
 * calls Yelp + Google on its behalf and returns just the numbers — never
 * the keys. Each provider's rating is returned separately and un-blended
 * (see README's data-strategy notes for why).
 *
 * Deploy: `wrangler deploy` from this directory. Secrets (set once, persist
 * across deploys): YELP_API_KEY, GOOGLE_PLACES_API_KEY, ALLOWED_ORIGIN,
 * APP_TOKEN. Also requires the RATINGS_RATE_LIMIT KV binding (see
 * wrangler.toml).
 *
 * Responses are marked no-store — Cloudflare's edge will otherwise cache a
 * GET response per exact query string indefinitely, which silently served
 * a stale/broken response for a long time during development.
 *
 * Two layers of abuse protection, since this endpoint is publicly
 * reachable at its workers.dev URL:
 *   1. APP_TOKEN: a shared value docs/app.js sends and this Worker checks.
 *      It's necessarily visible to anyone who reads the frontend's JS
 *      source (there's no way to keep a client-side value truly secret) —
 *      this only raises the bar against casual URL discovery/scanning,
 *      it is not a real access control.
 *   2. Per-IP rate limiting via KV: the actual protection against sustained
 *      abuse/cost exposure, independent of whether APP_TOKEN leaks.
 */

const RATE_LIMIT_MAX = 30; // requests per window, per IP
const RATE_LIMIT_WINDOW_SECONDS = 60; // KV's minimum TTL

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://josephvellutini-arch.github.io";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
      "Cache-Control": "no-store",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (env.APP_TOKEN && request.headers.get("X-App-Token") !== env.APP_TOKEN) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const withinLimit = await checkRateLimit(env, clientIp);
    if (!withinLimit) {
      return jsonResponse({ error: "Rate limit exceeded, try again shortly" }, 429, corsHeaders);
    }

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const address = url.searchParams.get("address") || "";
    const borough = url.searchParams.get("borough") || "";

    if (!name) {
      return jsonResponse({ error: "Missing 'name' query param" }, 400, corsHeaders);
    }

    const [yelp, google] = await Promise.all([
      fetchYelp(name, borough, env.YELP_API_KEY),
      fetchGoogle(name, address, env.GOOGLE_PLACES_API_KEY),
    ]);

    return jsonResponse({ yelp, google }, 200, corsHeaders);
  },
};

async function checkRateLimit(env, ip) {
  if (!env.RATINGS_RATE_LIMIT) return true; // fail open if KV isn't bound
  const key = `rl:${ip}`;
  const current = await env.RATINGS_RATE_LIMIT.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  // Not atomic (KV is eventually consistent) — a burst of concurrent
  // requests from the same IP could slip a few over the limit. Acceptable
  // for a coarse cap on cost exposure, not meant to be exact.
  await env.RATINGS_RATE_LIMIT.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

const YELP_LOCATION = {
  Manhattan: "New York, NY",
  Brooklyn: "Brooklyn, NY",
  Queens: "Queens, NY",
  Bronx: "Bronx, NY",
  StatenIsland: "Staten Island, NY",
};

async function fetchYelp(name, borough, apiKey) {
  if (!apiKey) return null;
  try {
    const location = YELP_LOCATION[borough] || "New York, NY";
    const params = new URLSearchParams({ term: name, location, limit: "1" });
    const resp = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const biz = data.businesses && data.businesses[0];
    if (!biz) return null;
    return { rating: biz.rating, review_count: biz.review_count, url: biz.url };
  } catch {
    return null;
  }
}

async function fetchGoogle(name, address, apiKey) {
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.rating,places.userRatingCount,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery: `${name} ${address}`.trim() }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const place = data.places && data.places[0];
    if (!place) return null;
    return {
      rating: place.rating,
      review_count: place.userRatingCount,
      url: place.googleMapsUri,
    };
  } catch {
    return null;
  }
}

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
