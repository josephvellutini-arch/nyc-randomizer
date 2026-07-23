const CATEGORY_LABELS = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  park: "Park",
  landmark: "Landmark",
  museum: "Museum / Cultural Org",
  public_art: "Public Art",
  market: "Market",
};

// Fixed display order for category sections in the results list.
const CATEGORY_ORDER = ["restaurant", "cafe", "park", "landmark", "museum", "public_art", "market"];

const BOROUGH_LABELS = {
  Manhattan: "Manhattan",
  Brooklyn: "Brooklyn",
  Queens: "Queens",
  Bronx: "Bronx",
  StatenIsland: "Staten Island",
};

// Yelp's find_loc expects a place name, not a borough code.
const YELP_LOCATION = {
  Manhattan: "New York, NY",
  Brooklyn: "Brooklyn, NY",
  Queens: "Queens, NY",
  Bronx: "Bronx, NY",
  StatenIsland: "Staten Island, NY",
};

// Live per-provider ratings (Cloudflare Worker proxy, keeps API keys
// server-side — see worker/README.md). Only fetched for categories where
// Yelp/Google actually have reliable business listings; parks/landmarks/etc.
// tend to fuzzy-match to unrelated nearby businesses, which would be
// misleading rather than useful.
const LIVE_RATINGS_URL = "https://nyc-randomizer-ratings.josephvellutini.workers.dev/";
// Not a real secret -- shipped in public JS, so anyone can read it. It only
// raises the bar against casual scanning; the Worker's own per-IP rate
// limit (via KV) is the actual protection against abuse/cost exposure.
const APP_TOKEN = "Y2DPXEyXYNeoDUzIBDLOFNtGTMPdxZl";
const LIVE_RATINGS_CATEGORIES = new Set(["restaurant", "cafe", "market"]);
// Cap on live fetches PER eligible category (not a shared total) — e.g. up
// to 5 restaurants + up to 5 cafes + up to 5 markets, so the cap scales
// with however many live-rated categories are actually in the itinerary
// instead of one category crowding out the others. Live fetching is also
// restricted to Top-N mode entirely (see generateItinerary) — Full
// Randomize can return the entire filtered set (thousands of venues), and
// no per-category cap alone would be safe against that.
const MAX_LIVE_FETCHES_PER_CATEGORY = 5;

// Plain search-query deep links (no scraping, no data copied) — built here
// instead of stored per-venue in venues.json to avoid nearly tripling that
// file's size with mostly-boilerplate URL strings.
function buildReviewLinks(venue) {
  const query = `${venue.name} ${venue.address || ""}`.trim();
  return {
    yelp: `https://www.yelp.com/search?find_desc=${encodeURIComponent(venue.name)}&find_loc=${encodeURIComponent(YELP_LOCATION[venue.borough] || "New York, NY")}`,
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    tripadvisor: `https://www.tripadvisor.com/Search?q=${encodeURIComponent(query)}`,
    apple_maps: `https://maps.apple.com/?q=${encodeURIComponent(query)}`,
  };
}

let allVenues = [];

const statusEl = document.getElementById("status");
const resultsListEl = document.getElementById("results-list");
const allNycCheckbox = document.getElementById("all-nyc");
const boroughChecks = Array.from(document.querySelectorAll(".borough-check"));
const categoryChecks = Array.from(document.querySelectorAll(".category-check"));

// --- Confirm / final itinerary setup -----------------------------------

const confirmBarEl = document.getElementById("confirm-bar");
const confirmCountEl = document.getElementById("confirm-count");
const buildRouteBtn = document.getElementById("build-route");
const finalItineraryEl = document.getElementById("final-itinerary");
const backToBrowsingBtn = document.getElementById("back-to-browsing");
const startTimeInput = document.getElementById("start-time");
const routeStepsEl = document.getElementById("route-steps");

// Confirmed venues persist across re-generating candidates -- confirming is
// meant to build up a plan over several browsing rounds, not just keep
// whatever the most recent single generation produced.
const confirmedVenues = new Map(); // venue.id -> venue
let currentRouteOrder = [];
let currentRouteLegs = []; // [{distanceMeters, durationSeconds}, ...], length = currentRouteOrder.length - 1
let currentRouteGeometry = []; // [[lat,lng], ...] for the polyline -- real street path or straight-line fallback
let currentRouteIsReal = false; // whether currentRouteGeometry/Legs came from OSRM or the fallback
let routePolyline = null;
const routeMarkers = new Map(); // venue.id -> L.marker (final-view only)

// --- Map setup ---------------------------------------------------------

const map = L.map("map", { scrollWheelZoom: true }).setView([40.7128, -73.95], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
}).addTo(map);

let neighborhoodsGeoJSON = null;
let neighborhoodLayer = null;
const categoryLayerGroups = new Map(); // category -> L.layerGroup
const markersByVenueId = new Map(); // venue.id -> L.marker

async function loadNeighborhoods() {
  try {
    const resp = await fetch("data/neighborhoods.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    neighborhoodsGeoJSON = await resp.json();
  } catch (err) {
    console.error("Couldn't load neighborhood boundaries", err);
  }
}

function clearMap() {
  categoryLayerGroups.forEach((layerGroup) => map.removeLayer(layerGroup));
  categoryLayerGroups.clear();
  markersByVenueId.clear();
  if (neighborhoodLayer) {
    map.removeLayer(neighborhoodLayer);
    neighborhoodLayer = null;
  }
}

function updateNeighborhoodOverlay(activeNeighborhoods) {
  if (neighborhoodLayer) {
    map.removeLayer(neighborhoodLayer);
    neighborhoodLayer = null;
  }
  if (!neighborhoodsGeoJSON) return;

  neighborhoodLayer = L.geoJSON(neighborhoodsGeoJSON, {
    interactive: false, // don't intercept hover/click meant for markers
    style: (feature) =>
      activeNeighborhoods.has(feature.properties.name)
        ? { color: "#4fa3ff", weight: 2, opacity: 0.85, fillOpacity: 0 }
        : { color: "transparent", weight: 0, fillColor: "#000000", fillOpacity: 0.55 },
  }).addTo(map);
  neighborhoodLayer.bringToBack();

  const activeLayers = [];
  neighborhoodLayer.eachLayer((layer) => {
    if (activeNeighborhoods.has(layer.feature.properties.name)) activeLayers.push(layer);
  });
  if (activeLayers.length > 0) {
    map.fitBounds(L.featureGroup(activeLayers).getBounds().pad(0.15));
  }
}

function buildPopupHtml(venue, liveResults) {
  let html = `
    <strong>${escapeHtml(venue.name)}</strong><br>
    <span>${escapeHtml(CATEGORY_LABELS[venue.category] || venue.category)}${venue.neighborhood ? ` &middot; ${escapeHtml(venue.neighborhood)}` : ""}</span>
  `;
  const google = liveResults && liveResults.find((r) => r && r.provider === "Google");
  if (google) {
    html += `<br>${starString(google.rating)} ${google.rating.toFixed(1)} (${google.review_count.toLocaleString()}) <a href="${escapeAttr(google.url)}" target="_blank" rel="noopener">View on Google</a>`;
  }
  return html;
}

async function loadVenues() {
  statusEl.textContent = "Loading venue data...";
  try {
    const [venuesResp] = await Promise.all([fetch("data/venues.json"), loadNeighborhoods()]);
    if (!venuesResp.ok) throw new Error(`HTTP ${venuesResp.status}`);
    allVenues = await venuesResp.json();
    statusEl.textContent = `Loaded ${allVenues.length.toLocaleString()} venues.`;
  } catch (err) {
    statusEl.textContent =
      "Couldn't load venue data. Run the pipeline (python pipeline/build.py) first.";
    console.error(err);
  }
}

allNycCheckbox.addEventListener("change", () => {
  boroughChecks.forEach((cb) => (cb.checked = allNycCheckbox.checked));
});

boroughChecks.forEach((cb) =>
  cb.addEventListener("change", () => {
    allNycCheckbox.checked = boroughChecks.every((c) => c.checked);
  })
);

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getSelectedValues(checks) {
  return checks.filter((c) => c.checked).map((c) => c.value);
}

// Size of the per-category "quality pool" that Top-N mode randomly draws
// from -- e.g. 25 highest-scored restaurants, 25 highest-scored parks, etc.
// The score itself is no longer shown to users (see buildPopupHtml/the
// venue-card template), just used internally to keep this pool from being
// a totally random draw across the whole category.
const TOP_POOL_SIZE = 25;

// Top-N mode: N picks PER selected category (not N total) -- e.g. N=5 with
// restaurant/cafe/park selected gives up to 5 restaurants + up to 5 cafes +
// up to 5 parks. Each category's N are drawn randomly from its own
// top-TOP_POOL_SIZE quality pool, so it's not the literal deterministic top
// N by score every time, just N random picks from the better-scored end.
function pickAcrossCategories(venues, n) {
  const pools = new Map();
  venues.forEach((v) => {
    if (!pools.has(v.category)) pools.set(v.category, []);
    pools.get(v.category).push(v);
  });

  const picked = [];
  pools.forEach((list, category) => {
    list.sort((a, b) => b.score - a.score);
    const pool = list.slice(0, TOP_POOL_SIZE);
    picked.push(...shuffle(pool).slice(0, n));
  });
  return picked;
}

// Full Randomize: exactly one venue per category present, chosen completely
// at random with no score/quality consideration at all -- distinct from
// pickAcrossCategories, which draws N *total* from a quality-filtered pool.
function pickOnePerCategory(venues) {
  const pools = new Map();
  venues.forEach((v) => {
    if (!pools.has(v.category)) pools.set(v.category, []);
    pools.get(v.category).push(v);
  });

  const picked = [];
  pools.forEach((pool) => {
    picked.push(pool[Math.floor(Math.random() * pool.length)]);
  });
  return picked;
}

// --- Route building (confirmed itinerary) -------------------------------
// Straight-line (haversine) distance/order only -- no street-following path,
// no third-party routing service. This will typically undercount real NYC
// walking time, since it ignores the street grid (you can't walk diagonally
// through a city block), but needs no external dependency or API key.

function haversineDistance(a, b) {
  const R = 6371000; // Earth radius, meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const WALK_METERS_PER_MIN = 83; // ~5 km/h, a typical adult walking pace

function estimateWalkMinutes(meters) {
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
}

function nearestNeighborOrder(start, remaining) {
  const order = [];
  let current = start;
  const pool = remaining.slice();
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineDistance(current, pool[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = pool.splice(bestIdx, 1)[0];
    order.push(current);
  }
  return order;
}

// Default suggested order for a confirmed itinerary: start at a cafe if one
// was confirmed, end at a restaurant if one was confirmed (the "cafe early,
// restaurant late" idea), nearest-neighbor-optimize everything in between.
// User can still freely reorder afterward -- this is just the starting
// suggestion, not a hard rule.
function buildDefaultRoute(venues) {
  if (venues.length <= 1) return venues.slice();

  const cafes = venues.filter((v) => v.category === "cafe");
  const restaurants = venues.filter((v) => v.category === "restaurant");

  const startVenue = cafes.length > 0 ? cafes[0] : venues[0];
  const endVenue =
    restaurants.length > 0 ? restaurants.find((r) => r !== startVenue) || restaurants[0] : null;

  const middlePool = venues.filter((v) => v !== startVenue && v !== endVenue);
  const middleOrdered = nearestNeighborOrder(startVenue, middlePool);

  const route = [startVenue, ...middleOrdered];
  if (endVenue && !route.includes(endVenue)) route.push(endVenue);
  return route;
}

function generateItinerary() {
  const boroughs = getSelectedValues(boroughChecks);
  const categories = getSelectedValues(categoryChecks);

  if (boroughs.length === 0) {
    statusEl.textContent = "Select at least one borough.";
    return;
  }
  if (categories.length === 0) {
    statusEl.textContent = "Select at least one category.";
    return;
  }

  // Every itinerary is a single-neighborhood outing: pick one borough at
  // random from whichever are checked, then one random neighborhood within
  // it (only from neighborhoods that actually have a matching venue, so we
  // never land on a dead end), then everything comes from just that
  // neighborhood -- not "somewhere in the borough," which for a borough as
  // large as Queens or Brooklyn could mean two picks miles apart.
  const chosenBorough = boroughs[Math.floor(Math.random() * boroughs.length)];

  const boroughFiltered = allVenues.filter(
    (v) => v.borough === chosenBorough && categories.includes(v.category)
  );

  if (boroughFiltered.length === 0) {
    statusEl.textContent = `No venues match those filters in ${BOROUGH_LABELS[chosenBorough] || chosenBorough} -- try generating again for a different borough.`;
    resultsListEl.innerHTML = "";
    clearMap();
    return;
  }

  const candidateNeighborhoods = Array.from(
    new Set(boroughFiltered.map((v) => v.neighborhood).filter(Boolean))
  );
  const chosenNeighborhood =
    candidateNeighborhoods[Math.floor(Math.random() * candidateNeighborhoods.length)];

  const filtered = boroughFiltered.filter((v) => v.neighborhood === chosenNeighborhood);

  const mode = document.querySelector('input[name="mode"]:checked').value;
  let itinerary;

  if (mode === "topn") {
    const n = Math.max(1, parseInt(document.getElementById("top-n").value, 10) || 5);
    itinerary = shuffle(pickAcrossCategories(filtered, n));
  } else {
    // Full Randomize: exactly one venue per selected category, picked
    // completely at random (no score/quality pool involved at all) --
    // previously this shuffled and returned the ENTIRE filtered set, which
    // with several thousand-venue categories meant "randomize" actually
    // showed thousands of results instead of a curated one-per-category pick.
    itinerary = shuffle(pickOnePerCategory(filtered));
  }

  statusEl.textContent = `Exploring ${chosenNeighborhood}, ${BOROUGH_LABELS[chosenBorough] || chosenBorough}: ${itinerary.length} stop${itinerary.length === 1 ? "" : "s"} (from ${filtered.length} matching venues in this neighborhood).`;
  // Live ratings only in Top-N mode. Full Randomize can return the entire
  // filtered set (thousands of venues) — never firing live fetches there
  // avoids blowing through Google's rate limits or billing.
  renderItinerary(itinerary, mode === "topn");
}

const REVIEW_LINK_LABELS = {
  yelp: "Yelp",
  google: "Google Maps",
  tripadvisor: "TripAdvisor",
  apple_maps: "Apple Maps",
};

function renderReviewLinks(links) {
  if (!links) return "";
  const items = Object.entries(links)
    .map(
      ([key, url]) =>
        `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${REVIEW_LINK_LABELS[key] || key}</a>`
    )
    .join(" · ");
  return `<p class="review-links">Check reviews: ${items}</p>`;
}

function starString(rating) {
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

function renderProviderRows(container, results) {
  const rows = results.filter(Boolean);
  if (rows.length === 0) {
    container.innerHTML = `<p class="live-caveat">No live ratings found for this venue.</p>`;
    return;
  }
  container.innerHTML = rows
    .map(
      (r) => `
      <div class="provider-row">
        <span class="provider-name">${escapeHtml(r.provider)}</span>
        <span class="provider-stars">${starString(r.rating)} ${r.rating.toFixed(1)}</span>
        <span class="provider-count">(${r.review_count.toLocaleString()})</span>
        <a href="${escapeAttr(r.url)}" target="_blank" rel="noopener">view</a>
      </div>`
    )
    .join("");
}

async function fetchLiveRatings(venue) {
  const params = new URLSearchParams({
    name: venue.name,
    address: venue.address || "",
    borough: venue.borough,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`${LIVE_RATINGS_URL}?${params}`, {
      signal: controller.signal,
      headers: { "X-App-Token": APP_TOKEN },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return [data.google && { provider: "Google", ...data.google }];
  } catch (err) {
    console.error("Live ratings fetch failed for", venue.name, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function renderItinerary(venues, fetchLive) {
  resultsListEl.innerHTML = "";
  clearMap();

  const groups = new Map();
  venues.forEach((v) => {
    if (!groups.has(v.category)) groups.set(v.category, []);
    groups.get(v.category).push(v);
  });
  const orderedCategories = CATEGORY_ORDER.filter((c) => groups.has(c));

  const liveFetchCountByCategory = new Map();

  orderedCategories.forEach((category) => {
    const categoryVenues = groups.get(category);

    const layerGroup = L.layerGroup().addTo(map);
    categoryLayerGroups.set(category, layerGroup);

    const details = document.createElement("details");
    details.open = true;
    details.className = "category-section";

    const summary = document.createElement("summary");
    summary.textContent = `${CATEGORY_LABELS[category] || category} (${categoryVenues.length})`;
    details.appendChild(summary);

    const cardsContainer = document.createElement("div");
    cardsContainer.className = "category-cards";
    details.appendChild(cardsContainer);

    details.addEventListener("toggle", () => {
      if (details.open) {
        layerGroup.addTo(map);
      } else {
        map.removeLayer(layerGroup);
      }
    });

    categoryVenues.forEach((v, i) => {
      const marker = L.marker([v.lat, v.lng]);
      marker.bindPopup(buildPopupHtml(v));
      marker.addTo(layerGroup);
      markersByVenueId.set(v.id, marker);

      const categoryCount = liveFetchCountByCategory.get(v.category) || 0;
      const eligibleForLive =
        fetchLive &&
        LIVE_RATINGS_CATEGORIES.has(v.category) &&
        categoryCount < MAX_LIVE_FETCHES_PER_CATEGORY;

      const liveSectionHtml = eligibleForLive
        ? `
          <div class="live-section" data-live-rows>
            <div class="live-heading"><span class="live-dot pulsing"></span> Live ratings</div>
            <div class="provider-rows">
              <div class="skeleton-row" style="width:70%"></div>
              <div class="skeleton-row" style="width:55%"></div>
            </div>
          </div>`
        : "";

      const isConfirmed = confirmedVenues.has(v.id);
      const card = document.createElement("article");
      card.className = "venue-card";
      card.innerHTML = `
        <div class="venue-index">${i + 1}</div>
        <div class="venue-body">
          <h3>${escapeHtml(v.name)}</h3>
          <p class="venue-meta">
            <span class="badge">${CATEGORY_LABELS[v.category] || v.category}</span>
            <button type="button" class="confirm-toggle${isConfirmed ? " confirmed" : ""}">${isConfirmed ? "✓ Added" : "+ Add to Route"}</button>
          </p>
          ${v.address ? `<p class="venue-address">${escapeHtml(v.address)}</p>` : ""}
          ${renderReviewLinks(buildReviewLinks(v))}
          ${liveSectionHtml}
        </div>
      `;
      cardsContainer.appendChild(card);

      card.addEventListener("mouseenter", () => {
        marker.openPopup();
        const el = marker.getElement();
        if (el) el.classList.add("marker-highlight");
      });
      card.addEventListener("mouseleave", () => {
        marker.closePopup();
        const el = marker.getElement();
        if (el) el.classList.remove("marker-highlight");
      });

      const confirmBtn = card.querySelector(".confirm-toggle");
      confirmBtn.addEventListener("click", () => {
        if (confirmedVenues.has(v.id)) {
          confirmedVenues.delete(v.id);
          confirmBtn.classList.remove("confirmed");
          confirmBtn.textContent = "+ Add to Route";
        } else {
          confirmedVenues.set(v.id, v);
          confirmBtn.classList.add("confirmed");
          confirmBtn.textContent = "✓ Added";
        }
        updateConfirmBar();
      });

      if (eligibleForLive) {
        liveFetchCountByCategory.set(v.category, categoryCount + 1);
        const dot = card.querySelector(".live-dot");
        const rows = card.querySelector(".provider-rows");
        fetchLiveRatings(v).then((results) => {
          renderProviderRows(rows, results);
          dot.classList.remove("pulsing");
          marker.setPopupContent(buildPopupHtml(v, results));
        });
      }
    });

    resultsListEl.appendChild(details);
  });

  const activeNeighborhoods = new Set(venues.map((v) => v.neighborhood).filter(Boolean));
  updateNeighborhoodOverlay(activeNeighborhoods);
}

// --- Confirm bar / final itinerary view ---------------------------------

function updateConfirmBar() {
  const count = confirmedVenues.size;
  if (count === 0) {
    confirmBarEl.hidden = true;
    return;
  }
  confirmBarEl.hidden = false;
  confirmCountEl.textContent = `${count} stop${count === 1 ? "" : "s"} confirmed`;
}

function showCandidateView() {
  finalItineraryEl.hidden = true;
  resultsListEl.hidden = false;
  if (confirmedVenues.size > 0) confirmBarEl.hidden = false;

  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeMarkers.forEach((marker) => map.removeLayer(marker));
  routeMarkers.clear();

  // Restore the candidate view's layers (neighborhood dim overlay + every
  // category's markers). Doesn't remember which category sections were
  // collapsed before switching views -- an accepted simplification, not
  // worth the extra state tracking for what's a cosmetic edge case.
  if (neighborhoodLayer) neighborhoodLayer.addTo(map);
  categoryLayerGroups.forEach((layerGroup) => layerGroup.addTo(map));
}

function showFinalItineraryView() {
  resultsListEl.hidden = true;
  confirmBarEl.hidden = true;
  finalItineraryEl.hidden = false;

  if (neighborhoodLayer) map.removeLayer(neighborhoodLayer);
  categoryLayerGroups.forEach((layerGroup) => map.removeLayer(layerGroup));

  currentRouteOrder = buildDefaultRoute(Array.from(confirmedVenues.values()));
  updateRoute();
}

function formatTimeOfDay(minutesFromMidnight) {
  const h24 = Math.floor(minutesFromMidnight / 60) % 24;
  const m = minutesFromMidnight % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function parseStartMinutes() {
  const [h, m] = (startTimeInput.value || "10:00").split(":").map(Number);
  return h * 60 + m;
}

function moveStep(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= currentRouteOrder.length) return;
  [currentRouteOrder[index], currentRouteOrder[target]] = [
    currentRouteOrder[target],
    currentRouteOrder[index],
  ];
  updateRoute();
}

// OSRM's free public routing server -- real street-following walking
// directions and accurate per-leg distance/time. No API key required, CORS
// is open. Same reliability caveat as the free Overpass instance we use
// elsewhere: no uptime guarantee, so every caller of this must be prepared
// for it to return null and fall back to the straight-line estimate.
const OSRM_URL = "https://router.project-osrm.org/route/v1/foot/";

async function fetchWalkingRoute(orderedVenues) {
  if (orderedVenues.length < 2) return null;
  const coords = orderedVenues.map((v) => `${v.lng},${v.lat}`).join(";");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`${OSRM_URL}${coords}?overview=full&geometries=geojson`, {
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.code !== "Ok" || !data.routes || !data.routes[0]) return null;
    const route = data.routes[0];
    return {
      legs: route.legs.map((leg) => ({
        distanceMeters: leg.distance,
        durationSeconds: leg.duration,
      })),
      geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
  } catch (err) {
    console.error("OSRM routing unavailable, falling back to straight-line estimate", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function straightLineFallback(orderedVenues) {
  const legs = [];
  for (let i = 1; i < orderedVenues.length; i++) {
    const meters = haversineDistance(orderedVenues[i - 1], orderedVenues[i]);
    legs.push({ distanceMeters: meters, durationSeconds: estimateWalkMinutes(meters) * 60 });
  }
  return { legs, geometry: orderedVenues.map((v) => [v.lat, v.lng]) };
}

// Recomputes the route whenever the stop ORDER changes (initial build,
// reorder) -- involves a network call, unlike renderRouteList (start-time
// changes only), which is why the two are split.
async function updateRoute() {
  routeStepsEl.innerHTML = `<li class="route-status">Finding walking directions...</li>`;

  const osrmResult = await fetchWalkingRoute(currentRouteOrder);
  if (osrmResult) {
    currentRouteLegs = osrmResult.legs;
    currentRouteGeometry = osrmResult.geometry;
    currentRouteIsReal = true;
  } else {
    const fallback = straightLineFallback(currentRouteOrder);
    currentRouteLegs = fallback.legs;
    currentRouteGeometry = fallback.geometry;
    currentRouteIsReal = false;
  }

  renderRouteList();
  drawRoutePolyline();
}

function renderRouteList() {
  routeStepsEl.innerHTML = "";

  const statusLi = document.createElement("li");
  statusLi.className = "route-status";
  statusLi.textContent = currentRouteIsReal
    ? "Walking directions via OpenStreetMap routing (OSRM)."
    : "Street routing unavailable right now -- showing straight-line distance estimates instead.";
  routeStepsEl.appendChild(statusLi);

  let cumulativeMinutes = parseStartMinutes();

  currentRouteOrder.forEach((v, i) => {
    if (i > 0) {
      const leg = currentRouteLegs[i - 1];
      const walkMinutes = Math.max(1, Math.round(leg.durationSeconds / 60));
      cumulativeMinutes += walkMinutes;

      const legLi = document.createElement("li");
      legLi.className = "route-leg";
      legLi.textContent = `↓ ${(leg.distanceMeters / 1609.34).toFixed(2)} mi, ~${walkMinutes} min walk`;
      routeStepsEl.appendChild(legLi);
    }

    const li = document.createElement("li");
    li.className = "route-step";
    li.innerHTML = `
      <div class="route-step-controls">
        <button type="button" data-dir="-1" ${i === 0 ? "disabled" : ""}>&uarr;</button>
        <button type="button" data-dir="1" ${i === currentRouteOrder.length - 1 ? "disabled" : ""}>&darr;</button>
      </div>
      <div class="venue-index">${i + 1}</div>
      <div class="venue-body">
        <h3>${escapeHtml(v.name)}</h3>
        <p class="venue-meta">
          <span class="badge">${CATEGORY_LABELS[v.category] || v.category}</span>
        </p>
        ${v.address ? `<p class="venue-address">${escapeHtml(v.address)}</p>` : ""}
        <p class="route-arrival">Estimated arrival: ${formatTimeOfDay(cumulativeMinutes)}</p>
      </div>
    `;
    li.querySelectorAll(".route-step-controls button").forEach((btn) => {
      btn.addEventListener("click", () => moveStep(i, Number(btn.dataset.dir)));
    });
    routeStepsEl.appendChild(li);
  });
}

function drawRoutePolyline() {
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeMarkers.forEach((marker) => map.removeLayer(marker));
  routeMarkers.clear();

  if (currentRouteOrder.length === 0) return;

  routePolyline = L.polyline(currentRouteGeometry, {
    color: "#4fa3ff",
    weight: 4,
    opacity: 0.8,
  }).addTo(map);

  currentRouteOrder.forEach((v, i) => {
    const marker = L.marker([v.lat, v.lng], {
      icon: L.divIcon({
        className: "route-marker",
        html: `<div class="route-marker-inner">${i + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    });
    marker.bindPopup(`<strong>${escapeHtml(v.name)}</strong>`);
    marker.addTo(map);
    routeMarkers.set(v.id, marker);
  });

  map.fitBounds(routePolyline.getBounds().pad(0.2));
}

buildRouteBtn.addEventListener("click", showFinalItineraryView);
backToBrowsingBtn.addEventListener("click", showCandidateView);
startTimeInput.addEventListener("change", () => {
  if (!finalItineraryEl.hidden) renderRouteList();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

document.getElementById("generate").addEventListener("click", generateItinerary);

loadVenues();
