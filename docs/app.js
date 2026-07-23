const CATEGORY_LABELS = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  park: "Park",
  landmark: "Landmark",
  museum: "Museum / Cultural Org",
  public_art: "Public Art",
  market: "Market",
};

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
const resultsEl = document.getElementById("results");
const allNycCheckbox = document.getElementById("all-nyc");
const boroughChecks = Array.from(document.querySelectorAll(".borough-check"));
const categoryChecks = Array.from(document.querySelectorAll(".category-check"));

async function loadVenues() {
  statusEl.textContent = "Loading venue data...";
  try {
    const resp = await fetch("data/venues.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allVenues = await resp.json();
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

  const filtered = allVenues.filter(
    (v) => boroughs.includes(v.borough) && categories.includes(v.category)
  );

  if (filtered.length === 0) {
    statusEl.textContent = "No venues match those filters.";
    resultsEl.innerHTML = "";
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;
  let itinerary;

  if (mode === "topn") {
    const n = Math.max(1, parseInt(document.getElementById("top-n").value, 10) || 5);
    const topSorted = filtered.slice().sort((a, b) => b.score - a.score);
    itinerary = shuffle(topSorted.slice(0, n));
  } else {
    itinerary = shuffle(filtered);
  }

  statusEl.textContent = `${itinerary.length} stop${itinerary.length === 1 ? "" : "s"} (from ${filtered.length} matching venues).`;
  // Live ratings only in Top-N mode. Full Randomize can return the entire
  // filtered set (thousands of venues) — never firing live fetches there
  // avoids blowing through Yelp/Google rate limits or Google billing.
  renderItinerary(itinerary, mode === "topn");
}

const REVIEW_LINK_LABELS = {
  yelp: "Yelp",
  google: "Google Maps",
  tripadvisor: "TripAdvisor",
  apple_maps: "Apple Maps",
};

function renderBreakdown(breakdown) {
  if (!breakdown || breakdown.length === 0) return "";
  const items = breakdown
    .map(
      (b) =>
        `<li>${escapeHtml(b.label)}: ${b.delta > 0 ? "+" : ""}${b.delta}</li>`
    )
    .join("");
  return `
    <details class="score-details">
      <summary>Why this score?</summary>
      <ul>${items}</ul>
    </details>
  `;
}

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
    return [
      data.yelp && { provider: "Yelp", ...data.yelp },
      data.google && { provider: "Google", ...data.google },
    ];
  } catch (err) {
    console.error("Live ratings fetch failed for", venue.name, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function renderItinerary(venues, fetchLive) {
  resultsEl.innerHTML = "";
  const liveFetchCountByCategory = new Map();

  venues.forEach((v, i) => {
    const card = document.createElement("article");
    card.className = "venue-card";

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

    card.innerHTML = `
      <div class="venue-index">${i + 1}</div>
      <div class="venue-body">
        <h3>${escapeHtml(v.name)}</h3>
        <p class="venue-meta">
          <span class="badge">${CATEGORY_LABELS[v.category] || v.category}</span>
          <span class="badge">${BOROUGH_LABELS[v.borough] || v.borough}</span>
          <span class="score">${escapeHtml(v.score_label || "")} (${v.score})</span>
        </p>
        ${v.address ? `<p class="venue-address">${escapeHtml(v.address)}</p>` : ""}
        ${renderBreakdown(v.score_breakdown)}
        ${renderReviewLinks(buildReviewLinks(v))}
        ${liveSectionHtml}
      </div>
    `;
    resultsEl.appendChild(card);

    if (eligibleForLive) {
      liveFetchCountByCategory.set(v.category, categoryCount + 1);
      const dot = card.querySelector(".live-dot");
      const rows = card.querySelector(".provider-rows");
      fetchLiveRatings(v).then((results) => {
        renderProviderRows(rows, results);
        dot.classList.remove("pulsing");
      });
    }
  });
}

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
