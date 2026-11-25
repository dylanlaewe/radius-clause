// Optional browser acceptance test. Requires Playwright and Chrome on the machine running it.
const assert = require("node:assert/strict");
const { readFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { chromium } = require("playwright");
const origin = process.argv[2] || "http://127.0.0.1:4173/";
const screenshotDir = process.argv[3];
const allErrors = [];
async function evidence(page, button, type) {
  const pending = page.waitForEvent("download");
  await page.locator(button).click();
  const data = await readFile(await (await pending).path(), "utf8");
  return type === "json" ? JSON.parse(data) : data;
}
async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const size of [
      { width: 1440, height: 950 },
      { width: 390, height: 844 },
    ]) {
      const mobile = size.width < 600;
      const context = await browser.newContext({
        viewport: size,
        deviceScaleFactor: 1,
        acceptDownloads: true,
      });
      try {
        const page = await context.newPage();
        page.on("pageerror", (e) => allErrors.push(e.message));
        const response = await page.goto(origin);
        assert.equal(response.status(), 200);
        await page.locator("#desk").waitFor();
        await page.getByText(/Applied to \d+ storms/).waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.match(
          await page.locator("#event-title").innerText(),
          /Ian \/ 2022/,
        );
        assert.match(
          await page.locator("#event-result").innerText(),
          /Only B pays/,
        );
        assert.equal(await page.locator("#a-payout").innerText(), "$0");
        assert.equal(await page.locator("#b-payout").innerText(), "$1,000,000");
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "Horizontal overflow",
        );
        if (screenshotDir) {
          await mkdir(screenshotDir, { recursive: true });
          await page.screenshot({
            path: join(screenshotDir, mobile ? "mobile.png" : "workbench.png"),
            animations: "disabled",
          });
        }
        await page.locator("#method-open").click();
        await page.locator("dialog[open]").waitFor();
        await page.keyboard.press("Escape");
        const before = await page.locator("#fix-count").innerText();
        await page.locator("#next").click();
        assert.notEqual(await page.locator("#fix-count").innerText(), before);
        await page.locator("#focus-fix").click();
        const archive = await evidence(page, "#export", "json");
        assert.ok(archive.summary.storms > 400);
        assert.equal(archive.annual.length, 36);
        assert.equal(archive.selectedStorm, "AL092022");
        const row = archive.rows.find((r) => r.id === archive.selectedStorm);
        assert.equal(archive.selectedObservation[0], row.b.closestIntense.time);
        await page.locator("#loss-details summary").click();
        await page
          .locator("#loss-input")
          .fill("storm_id,loss_usd\nAL092022,750000");
        await page.locator("#apply-loss").click();
        assert.match(await page.locator("#loss-result").innerText(), /750,000/);
        const brief = await evidence(page, "#brief", "html");
        assert.match(brief, /Supplied loss history/);
        assert.match(brief, /AL092022/);
        const withLoss = await evidence(page, "#export", "json");
        assert.equal(withLoss.suppliedLossComparison.b.excessUSD, 250000);
        await page.locator("#filter").selectOption("all");
        await page.locator("#search").fill("KATRINA");
        await page.locator("#rows button").filter({ hasText: "2005" }).click();
        assert.match(await page.locator("#event-title").innerText(), /Katrina/);
        await page
          .locator("#a-radius")
          .fill(await page.locator("#b-radius").inputValue());
        await page.locator("#run").click();
        await page.locator("#filter").selectOption("flip");
        assert.match(
          await page.locator("#rows").innerText(),
          /No storms match/,
        );
        await page.locator("#site").selectOption("custom");
        await page.locator("#lat").fill("18.4655");
        await page.locator("#lon").fill("-66.1057");
        await page.locator("#run").click();
        assert.equal(
          (await evidence(page, "#export", "json")).suppliedLossComparison,
          null,
        );
        const cell = page.locator(
          '#surface button[aria-label^="64 knots, 100 kilometres"]',
        );
        const expected = Number(await cell.innerText());
        await cell.click();
        assert.equal(await page.locator("#b-wind").inputValue(), "64");
        assert.equal(
          (await evidence(page, "#export", "json")).summary.matchedB,
          expected,
        );
        console.log(
          size.width +
            "px verified at " +
            origin +
            " (" +
            archive.summary.storms +
            " storms, " +
            archive.annual.length +
            " seasons).",
        );
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(allErrors, []);
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
