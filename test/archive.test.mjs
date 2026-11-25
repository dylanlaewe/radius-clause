import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareRules } from "../site/engine.mjs";
import { makeBrief } from "../site/brief.mjs";

const readJSON = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("Fort Myers replay retains the off-cycle Punta Gorda observation documented by NHC", async () => {
  const archive = await readJSON("../site/data/atlantic.json");
  const rules = await readJSON("../example-rules.json");
  const report = compareRules(archive, rules.ruleA, rules.ruleB);
  const ian = report.rows.find((row) => row.id === "AL092022");
  assert.equal(ian.change, "b-only");
  assert.equal(ian.a.payoutUSD, 0);
  assert.equal(ian.b.payoutUSD, 1000000);
  const fix = ian.b.closestIntense;
  // NHC Hurricane Ian report, Table 1: September 28, 2035 UTC, 26.8°N 82.0°W.
  assert.equal(Date.parse(fix.time), Date.UTC(2022, 8, 28, 20, 35));
  assert.deepEqual(
    [fix.lat, fix.lon, fix.windKt, fix.status],
    [26.8, -82.0, 125, "HU"],
  );
  assert.ok(fix.distanceKm > 21 && fix.distanceKm < 23);
  assert.equal(report.summary.storms, 592);
  assert.equal(report.summary.matchedA, 0);
  assert.equal(report.summary.matchedB, 2);
  assert.equal(report.annual.length, 36);
  assert.equal(report.annual[0].year, 1990);
  assert.equal(report.annual.at(-1).year, 2025);
  const html = makeBrief(
    { name: "Fort Myers, Florida", lat: rules.ruleA.lat, lon: rules.ruleA.lon },
    report,
    ian,
    archive.meta,
    null,
  );
  assert.match(html, /AL092022/);
  assert.doesNotMatch(html, /\b(undefined|NaN)\b/);
});
