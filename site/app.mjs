import { compareRules, distanceKm } from "./engine.mjs";
import { renderMap } from "./map.mjs";
import { parseLosses, scoreLosses } from "./loss.mjs";
import { makeBrief } from "./brief.mjs";

const byId = (id) => document.getElementById(id);
const sites = [
  {
    id: "fort-myers",
    name: "Fort Myers, Florida",
    lat: 26.6406,
    lon: -81.8723,
    storm: "AL092022",
  },
  {
    id: "miami",
    name: "Miami, Florida",
    lat: 25.7617,
    lon: -80.1918,
    storm: "AL041992",
  },
  {
    id: "new-orleans",
    name: "New Orleans, Louisiana",
    lat: 29.9511,
    lon: -90.0715,
    storm: "AL122005",
  },
  {
    id: "san-juan",
    name: "San Juan, Puerto Rico",
    lat: 18.4655,
    lon: -66.1057,
    storm: "AL152017",
  },
  {
    id: "kingston",
    name: "Kingston, Jamaica",
    lat: 17.997,
    lon: -76.7936,
    storm: "AL022024",
  },
  { id: "custom", name: "Custom coordinates", lat: 26.6406, lon: -81.8723 },
];
const windGrid = [34, 50, 64, 83, 96, 113, 137];
const radiusGrid = [10, 25, 50, 75, 100, 150, 250];
const perPage = 8;
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const dateLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const label = (name) =>
  name.toLowerCase().replace(/(^|[- ])[a-z]/g, (s) => s.toUpperCase());
const set = (id, value) => {
  byId(id).textContent = value;
};
let archive,
  land,
  report,
  site,
  active,
  fixIndex,
  page = 0;
let stormIndex, lossValues, lossScore;
let surfaceCache = { key: "", counts: [] };

function build(id, text) {
  const node = document.createElement(id);
  node.textContent = text;
  return node;
}

function readRule(prefix, location) {
  return {
    lat: location.lat,
    lon: location.lon,
    radiusKm: byId(prefix + "-radius").valueAsNumber,
    minWindKt: byId(prefix + "-wind").valueAsNumber,
    limitUSD: byId("limit").valueAsNumber,
  };
}

function proposedSite() {
  const selected = sites.find((s) => s.id === byId("site").value);
  if (selected.id !== "custom") return selected;
  return {
    ...selected,
    lat: byId("lat").valueAsNumber,
    lon: byId("lon").valueAsNumber,
  };
}

function setCoordinateInputs() {
  const custom = byId("site").value === "custom";
  byId("coords").hidden = !custom;
  byId("lat").disabled = byId("lon").disabled = !custom;
  if (!custom) {
    const selected = proposedSite();
    byId("lat").value = selected.lat;
    byId("lon").value = selected.lon;
  }
}

function focusPoint(point) {
  if (!point) return;
  const index = stormIndex
    .get(active.id)
    .points.findIndex(
      (p) => p[0] === point.time && p[1] === point.lat && p[2] === point.lon,
    );
  if (index >= 0) selectFix(index);
}

function selectFix(index) {
  const storm = stormIndex.get(active.id);
  fixIndex = Math.max(0, Math.min(storm.points.length - 1, index));
  const point = storm.points[fixIndex];
  const [time, lat, lon, wind, status] = point;
  const distance = distanceKm(site.lat, site.lon, lat, lon);
  byId("fix").value = fixIndex;
  byId("prev").disabled = fixIndex === 0;
  byId("next").disabled = fixIndex === storm.points.length - 1;
  set("fix-count", fixIndex + 1 + " / " + storm.points.length);
  set("fix-date", dateLabel.format(new Date(time)) + " UTC");
  set("fix-wind", wind + " kt · " + status);
  set("fix-distance", distance.toFixed(1) + " km from site");
  renderMap(byId("map"), {
    storm,
    site,
    ruleA: report.ruleA,
    ruleB: report.ruleB,
    activePoint: fixIndex,
    land,
    onSelect: selectFix,
  });
}

function describe(result) {
  if (result.strongest)
    return (
      result.strongest.windKt +
      " kt at " +
      result.strongest.distanceKm.toFixed(1) +
      " km"
    );
  if (result.closestIntense)
    return (
      result.closestIntense.distanceKm.toFixed(1) +
      " km to closest wind-qualified fix"
    );
  return "No fix met the wind threshold";
}

function selectStorm(row, scroll = false) {
  active = row;
  const storm = stormIndex.get(row.id);
  set("event-title", label(row.name) + " / " + row.year);
  const states = {
    "b-only": "Only B pays",
    "a-only": "Only A pays",
    both: "Both clauses pay",
    neither: "Neither clause pays",
  };
  set("event-result", states[row.change]);
  byId("event-result").classList.toggle("flip", row.change.endsWith("-only"));
  for (const key of ["a", "b"]) {
    set(key + "-payout", dollars.format(row[key].payoutUSD));
    set(key + "-note", describe(row[key]));
  }
  const boundary = row.b.closestIntense;
  set(
    "breakpoint",
    boundary ? boundary.distanceKm.toFixed(2) + " km" : "No qualifying fix",
  );
  set(
    "breakpoint-note",
    boundary
      ? "Closest center fix at or above " +
          report.ruleB.minWindKt +
          " kt. Radius shown rounded."
      : "Every eligible observation fell below " +
          report.ruleB.minWindKt +
          " kt.",
  );
  byId("focus-fix").hidden = !boundary;
  byId("fix").max = storm.points.length - 1;
  const evidence =
    row.b.strongest || row.a.strongest || boundary || row.a.closestIntense;
  if (evidence) focusPoint(evidence);
  else {
    const distances = storm.points.map((p) =>
      distanceKm(site.lat, site.lon, p[1], p[2]),
    );
    selectFix(distances.indexOf(Math.min(...distances)));
  }
  if (scroll) {
    renderRows();
    document
      .querySelector(".event")
      .scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  }
}

function renderRows() {
  const query = byId("search").value.trim().toUpperCase();
  const mode = byId("filter").value;
  const rows = report.rows
    .filter(
      (row) =>
        (mode === "all" ||
          (mode === "hit"
            ? row.change !== "neither"
            : row.change.endsWith("-only"))) &&
        (row.name + " " + row.year + " " + row.id).includes(query),
    )
    .sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / perPage) - 1));
  const body = byId("rows");
  body.replaceChildren();
  for (const row of rows.slice(page * perPage, (page + 1) * perPage)) {
    const tr = document.createElement("tr");
    tr.classList.toggle("active", row.id === active.id);
    const cell = document.createElement("td");
    const button = build("button", label(row.name) + " / " + row.year);
    button.setAttribute(
      "aria-label",
      "Inspect " + label(row.name) + " " + row.id,
    );
    button.addEventListener("click", () => selectStorm(row, true));
    cell.append(button, build("small", row.id));
    tr.append(
      cell,
      build("td", dollars.format(row.a.payoutUSD)),
      build("td", dollars.format(row.b.payoutUSD)),
      build(
        "td",
        row.b.minTriggerRadiusKm === null
          ? "—"
          : row.b.minTriggerRadiusKm.toFixed(2) + " km",
      ),
    );
    body.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement("tr");
    const cell = build(
      "td",
      "No storms match this view. Try “All storms” or change the terms.",
    );
    cell.colSpan = 4;
    tr.append(cell);
    body.append(tr);
  }
  set(
    "row-count",
    rows.length
      ? page * perPage +
          1 +
          "–" +
          Math.min(rows.length, (page + 1) * perPage) +
          " of " +
          rows.length +
          " storms"
      : "0 storms",
  );
  byId("back").disabled = page === 0;
  byId("more").disabled = (page + 1) * perPage >= rows.length;
}

function renderMetrics() {
  const s = report.summary;
  const metrics = byId("metrics");
  metrics.replaceChildren();
  for (const [value, title] of [
    [s.storms, "archived storms"],
    [s.matchedA, "trigger A"],
    [s.matchedB, "trigger B"],
    [s.aOnly + s.bOnly, "change outcome"],
  ]) {
    const span = document.createElement("span");
    span.append(build("b", value), document.createTextNode(title));
    metrics.append(span);
  }
}

function surfaceCounts() {
  const key = site.lat + "," + site.lon;
  if (surfaceCache.key === key) return surfaceCache.counts;
  const counts = windGrid.map(() => radiusGrid.map(() => 0));
  for (const storm of archive.storms) {
    const nearest = windGrid.map(() => Infinity);
    for (const [, lat, lon, wind, status] of storm.points) {
      if (status !== "HU" && status !== "TS") continue;
      const distance = distanceKm(site.lat, site.lon, lat, lon);
      for (let w = 0; w < windGrid.length && wind >= windGrid[w]; w++)
        nearest[w] = Math.min(nearest[w], distance);
    }
    nearest.forEach((d, w) =>
      radiusGrid.forEach((r, i) => {
        if (d <= r) counts[w][i]++;
      }),
    );
  }
  surfaceCache = { key, counts };
  return counts;
}

function renderSurface() {
  const counts = surfaceCounts();
  const max = Math.max(1, ...counts.flat());
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  for (const text of ["Wind / radius", ...radiusGrid.map((r) => r + " km")])
    header.append(build("th", text));
  const body = table.createTBody();
  windGrid.forEach((wind, w) => {
    const tr = body.insertRow();
    const rowHeader = build("th", wind + " kt");
    rowHeader.scope = "row";
    tr.append(rowHeader);
    radiusGrid.forEach((radius, r) => {
      const count = counts[w][r];
      const cell = tr.insertCell();
      const button = build("button", count);
      const selected =
        radius === report.ruleB.radiusKm && wind === report.ruleB.minWindKt;
      button.classList.toggle("chosen", selected);
      button.setAttribute("aria-pressed", selected);
      button.setAttribute(
        "aria-label",
        wind +
          " knots, " +
          radius +
          " kilometres, " +
          count +
          " storms. Apply to clause B",
      );
      button.style.backgroundColor =
        "hsl(160 26% " + (97 - 48 * Math.sqrt(count / max)) + "%)";
      button.addEventListener("click", () => {
        if (byId("form-status").dataset.pending === "yes") {
          set(
            "form-status",
            "Run your term changes before applying a sensitivity cell.",
          );
          byId("terms-form").scrollIntoView({ block: "center" });
          return;
        }
        byId("b-wind").value = wind;
        byId("b-radius").value = radius;
        runComparison();
        byId("event-title").scrollIntoView({ block: "start" });
      });
      cell.append(button);
    });
  });
  byId("surface").replaceChildren(table);
}

function runComparison() {
  const nextSite = proposedSite();
  const next = compareRules(
    archive,
    readRule("a", nextSite),
    readRule("b", nextSite),
  );
  const sameSite =
    site &&
    site.id === nextSite.id &&
    site.lat === nextSite.lat &&
    site.lon === nextSite.lon;
  const preferredId = sameSite ? active?.id : nextSite.storm;
  if (!sameSite) {
    lossValues = null;
    byId("loss-input").value = "";
  }
  report = next;
  site = nextSite;
  updateLossView();
  page = 0;
  selectStorm(
    report.rows.find((r) => r.id === preferredId) ||
      report.rows.find((r) => r.change.endsWith("-only")) ||
      report.rows.find((r) => r.change === "both") ||
      report.rows[0],
  );
  renderRows();
  renderMetrics();
  renderSurface();
  byId("form-status").dataset.pending = "no";
  set("form-status", "Applied to " + report.summary.storms + " storms.");
}

async function fetchFile(name) {
  const response = await fetch(new URL("./data/" + name, import.meta.url));
  if (!response.ok)
    throw new Error("Unable to load " + name + " (" + response.status + ")");
  return response.json();
}

function updateLossView() {
  lossScore = lossValues ? scoreLosses(report, lossValues) : null;
  const target = byId("loss-result");
  target.replaceChildren();
  if (!lossScore) return;
  const amounts = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  const table = document.createElement("table");
  const heading = table.createTHead().insertRow();
  for (const text of ["Observed records", "Clause A", "Clause B"])
    heading.append(build("th", text));
  const body = table.createTBody();
  for (const [name, key] of [
    ["Loss above payout", "uncoveredUSD"],
    ["Payout above loss", "excessUSD"],
  ]) {
    const row = body.insertRow();
    row.append(
      build("th", name),
      build("td", amounts.format(lossScore.a[key])),
      build("td", amounts.format(lossScore.b[key])),
    );
  }
  target.append(
    build(
      "p",
      lossScore.observedStorms +
        " supplied storms at " +
        site.name +
        ". " +
        lossScore.unreportedStorms +
        " have unknown losses.",
    ),
    table,
  );
}

function exportEvidence() {
  const evidence = {
    format: "radius-clause/replay-v1",
    archive: archive.meta,
    referenceSite: site,
    suppliedLossComparison: lossScore,
    selectedStorm: active.id,
    selectedObservation: stormIndex.get(active.id).points[fixIndex],
    ...report,
  };
  download(
    JSON.stringify(evidence, null, 2) + "\n",
    "application/json",
    "json",
  );
}

function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    "radius-clause-" + site.id + "-" + active.id + "." + extension;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

byId("method-open").addEventListener("click", () => byId("method").showModal());
byId("method-close").addEventListener("click", () => byId("method").close());
byId("site").addEventListener("change", setCoordinateInputs);
byId("terms-form").addEventListener("input", () => {
  byId("form-status").dataset.pending = "yes";
  set("form-status", "Run comparison to apply your changes.");
});
byId("terms-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    runComparison();
  } catch (error) {
    set("form-status", error.message);
  }
});
byId("filter").addEventListener("change", () => {
  page = 0;
  renderRows();
});
byId("search").addEventListener("input", () => {
  page = 0;
  renderRows();
});
byId("back").addEventListener("click", () => {
  page--;
  renderRows();
});
byId("more").addEventListener("click", () => {
  page++;
  renderRows();
});
byId("prev").addEventListener("click", () => selectFix(fixIndex - 1));
byId("next").addEventListener("click", () => selectFix(fixIndex + 1));
byId("fix").addEventListener("input", (event) =>
  selectFix(event.target.valueAsNumber),
);
byId("focus-fix").addEventListener("click", () => {
  focusPoint(active.b.closestIntense);
  byId("fix").focus({ preventScroll: true });
  byId("event-title").scrollIntoView({ block: "start" });
});
byId("export").addEventListener("click", exportEvidence);
byId("brief").addEventListener("click", () =>
  download(
    makeBrief(site, report, active, archive.meta, lossScore),
    "text/html",
    "html",
  ),
);
byId("loss-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (byId("form-status").dataset.pending === "yes") {
    set(
      "loss-result",
      "Run your proposed term changes first, then apply the loss records.",
    );
    return;
  }
  try {
    lossValues = parseLosses(byId("loss-input").value, stormIndex);
    updateLossView();
  } catch (error) {
    lossValues = null;
    lossScore = null;
    set("loss-result", error.message);
  }
});
byId("clear-loss").addEventListener("click", () => {
  lossValues = null;
  byId("loss-input").value = "";
  updateLossView();
});
try {
  [archive, land] = await Promise.all([
    fetchFile("atlantic.json"),
    fetchFile("land.json"),
  ]);
  stormIndex = new Map(archive.storms.map((storm) => [storm.id, storm]));
  for (const location of sites)
    byId("site").add(new Option(location.name, location.id));
  for (const [id, value] of Object.entries({
    "a-radius": 20,
    "b-radius": 75,
    "a-wind": 96,
    "b-wind": 96,
    limit: 1000000,
  }))
    byId(id).value = value;
  setCoordinateInputs();
  byId("desk").hidden = false;
  runComparison();
  byId("loading").hidden = true;
} catch (error) {
  byId("desk").hidden = true;
  set(
    "loading",
    "The archive could not be opened. Reload the page to try again. " +
      error.message,
  );
}
