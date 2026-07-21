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
  renderItinerary(itinerary);
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

function renderItinerary(venues) {
  resultsEl.innerHTML = "";
  venues.forEach((v, i) => {
    const card = document.createElement("article");
    card.className = "venue-card";
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
      </div>
    `;
    resultsEl.appendChild(card);
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
