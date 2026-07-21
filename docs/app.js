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
          <span class="score">Score: ${v.score}</span>
        </p>
        ${v.address ? `<p class="venue-address">${escapeHtml(v.address)}</p>` : ""}
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

document.getElementById("generate").addEventListener("click", generateItinerary);

loadVenues();
