const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const showMoney = (n) => money.format(n);
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cell = (text) => "<td>" + escape(text) + "</td>";
function table(headings, rows) {
  return (
    "<table><thead><tr>" +
    headings.map((t) => "<th>" + escape(t) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows.map((row) => "<tr>" + row.map(cell).join("") + "</tr>").join("") +
    "</tbody></table>"
  );
}
function observation(row) {
  if (!row.strongest) return "No eligible fix inside the circle";
  const fix = row.strongest;
  return (
    fix.time + " · " + fix.windKt + " kt · " + fix.distanceKm.toFixed(2) + " km"
  );
}
export function makeBrief(site, report, active, archiveMeta, losses) {
  const s = report.summary;
  const { ruleA, ruleB } = report;
  const changes = report.rows.filter(
    (r) => r.change === "a-only" || r.change === "b-only",
  );
  const clauses = table(
    [
      "Clause",
      "Radius",
      "Minimum wind",
      "Per-storm limit",
      "Triggered storms",
      "Seasons with a trigger",
    ],
    [
      [
        "A",
        ruleA.radiusKm + " km",
        ruleA.minWindKt + " kt",
        showMoney(ruleA.limitUSD),
        s.matchedA,
        s.yearsTriggeredA,
      ],
      [
        "B",
        ruleB.radiusKm + " km",
        ruleB.minWindKt + " kt",
        showMoney(ruleB.limitUSD),
        s.matchedB,
        s.yearsTriggeredB,
      ],
    ],
  );
  const evidence = table(
    [
      "Clause",
      "Hypothetical payout",
      "Strongest eligible observation inside the circle",
    ],
    [
      ["A", showMoney(active.a.payoutUSD), observation(active.a)],
      ["B", showMoney(active.b.payoutUSD), observation(active.b)],
    ],
  );
  const changed = changes.length
    ? table(
        [
          "NOAA ID",
          "Storm",
          "Clause A",
          "Clause B",
          "Minimum B radius at chosen wind",
        ],
        changes.map((r) => [
          r.id,
          r.name,
          showMoney(r.a.payoutUSD),
          showMoney(r.b.payoutUSD),
          r.b.minTriggerRadiusKm === null
            ? "No eligible fix"
            : r.b.minTriggerRadiusKm.toFixed(2) + " km",
        ]),
      )
    : "<p>Both clauses give the same trigger outcome for every storm in the archive.</p>";
  const lossSection = losses
    ? "<h2>Supplied loss history</h2><p>Only the " +
      losses.observedStorms +
      " supplied records enter this calculation. The other " +
      losses.unreportedStorms +
      " storm losses are unknown.</p>" +
      table(
        ["Metric", "Clause A", "Clause B"],
        [
          [
            "Loss above payout",
            showMoney(losses.a.uncoveredUSD),
            showMoney(losses.b.uncoveredUSD),
          ],
          [
            "Payout above loss",
            showMoney(losses.a.excessUSD),
            showMoney(losses.b.excessUSD),
          ],
        ],
      )
    : "";
  return (
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Radius Clause | Historical trigger brief</title><style>body{max-width:880px;margin:auto;padding:34px 20px;font:16px/1.45 system-ui;color:#17343a}header{border-top:5px solid #d57c4a}h1{margin-bottom:4px}h2{margin-top:30px}p,td,th{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:7px;text-align:left;border-bottom:1px solid #becdc7}th{background:#eaf0ec}pre{font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere}footer{margin:25px 0}@media print{thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}body{padding:0}}</style>" +
    "<header><p>RADIUS CLAUSE · HISTORICAL TRIGGER BRIEF</p><h1>" +
    escape(site.name) +
    "</h1><p>" +
    site.lat +
    "°, " +
    site.lon +
    "° · Atlantic seasons 1990–2025</p></header>" +
    "<p>" +
    changes.length +
    " of " +
    s.storms +
    " archived storms change trigger outcome between these two proposals.</p>" +
    clauses +
    "<h2>" +
    escape(active.name) +
    " / " +
    active.year +
    "</h2>" +
    evidence +
    "<h2>Storms with a changed trigger</h2>" +
    changed +
    lossSection +
    "<h2>Season ledger</h2>" +
    table(
      ["Season", "A triggers", "B triggers", "A payout", "B payout"],
      report.annual.map((y) => [
        y.year,
        y.countA,
        y.countB,
        showMoney(y.payoutAUSD),
        showMoney(y.payoutBUSD),
      ]),
    ) +
    "<h2>Scope and provenance</h2><p>Each rule pays its full limit once per storm when a recorded HU or TS center lies at or inside its radius and meets its wind threshold at that same fix. Distance uses a spherical great circle. No between-fix interpolation or annual aggregate limit is applied. The wind is the storm maximum. The archive is retrospective. Site damage, contract settlements and forward probabilities require additional information.</p><pre>" +
    escape(JSON.stringify(archiveMeta, null, 2)) +
    "</pre>" +
    '<footer><a href="https://www.nhc.noaa.gov/data/">NOAA archive</a> · <a href="https://github.com/dylanlaewe/radius-clause">Source and methodology</a></footer></html>'
  );
}
