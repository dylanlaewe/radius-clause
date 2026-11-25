import test from "node:test";
import assert from "node:assert/strict";
import {
  distanceKm,
  evaluateStorm,
  compareRules,
  validateRule,
} from "../site/engine.mjs";

const rule = {
  lat: 10,
  lon: -20,
  radiusKm: 100,
  minWindKt: 96,
  limitUSD: 250.1,
};
const storm = (points) => ({
  id: "AL012020",
  name: "TEST",
  year: 2020,
  points,
});
const time = "2020-08-01T12:00:00Z";
test("wind and distance must both qualify at one recorded observation", () => {
  const item = storm([
    [time, 10, -20, 90, "HU"],
    [time, 15, -20, 110, "HU"],
    [time, 10, -20, 110, "EX"],
  ]);
  const result = evaluateStorm(item, rule);
  assert.equal(result.triggered, false);
  assert.ok(result.minTriggerRadiusKm > 500);
});
test("equality qualifies and the nearest intense fix differs from the strongest fix", () => {
  const boundary = distanceKm(10, -20, 10, -19.5);
  const item = storm([
    [time, 10, -19.5, 120, "HU"],
    [time, 10, -20, 96, "TS"],
  ]);
  const result = evaluateStorm(item, { ...rule, radiusKm: boundary });
  assert.equal(result.strongest.windKt, 120);
  assert.equal(result.closestIntense.windKt, 96);
  assert.equal(result.minTriggerRadiusKm, 0);
  assert.equal(result.payoutUSD, 250.1);
  assert.equal(evaluateStorm(item, { ...rule, radiusKm: 0 }).triggered, true);
});
test("annual ledger retains zero seasons and deduplicates payouts across fixes", () => {
  const item = storm([
    [time, 10, -20, 100, "HU"],
    ["2020-08-01T18:00:00Z", 10, -20, 105, "HU"],
  ]);
  const result = compareRules({ storms: [item] }, rule, {
    ...rule,
    minWindKt: 120,
  });
  assert.equal(result.annual.length, 36);
  assert.equal(result.summary.aOnly, 1);
  assert.equal(result.summary.yearsTriggeredA, 1);
  assert.equal(result.summary.payoutAUSD, 250.1);
  assert.equal(result.rows[0].b.minTriggerRadiusKm, null);
  assert.throws(() => compareRules({ storms: [item, item] }, rule, rule));
});
test("antimeridian distance and invalid numeric inputs", () => {
  const km = distanceKm(0, 179.9, 0, -179.9);
  assert.ok(km > 22 && km < 23);
  for (const bad of [
    { lon: Infinity },
    { radiusKm: -1 },
    { lat: "10" },
    { minWindKt: NaN },
    { limitUSD: 1.123 },
  ])
    assert.throws(() => validateRule({ ...rule, ...bad }));
});
