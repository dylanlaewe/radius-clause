import test from "node:test";
import assert from "node:assert/strict";
import { parseLosses, scoreLosses } from "../site/loss.mjs";
const valid = new Set(["AL092022", "AL092021", "AL092020"]);
test("unreported storms are unknown and explicit zero loss can show excess trigger payout", () => {
  const values = parseLosses(
    "storm_id,loss_usd\r\nAL092022,600.30\r\nAL092021,0\n",
    valid,
  );
  const report = {
    rows: [...valid].map((id) => ({
      id,
      a: { payoutUSD: 0 },
      b: { payoutUSD: 100 },
    })),
  };
  const stats = scoreLosses(report, values);
  assert.equal(stats.unreportedStorms, 1);
  assert.deepEqual(stats.a, { uncoveredUSD: 600.3, excessUSD: 0 });
  assert.deepEqual(stats.b, { uncoveredUSD: 500.3, excessUSD: 100 });
});
test("malformed or ambiguous losses are rejected", () => {
  for (const bad of [
    "",
    "storm_id,loss_usd",
    "AL092022,",
    "AL092022,3,500",
    "AL092022,-1",
    "AL092022,1\nAL092022,0",
    "AL009999,1",
    "AL092022,1.234",
    "AL092022,10000000000",
  ]) {
    assert.throws(() => parseLosses(bad, valid));
  }
});
