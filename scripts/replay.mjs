import { readFile, stat } from "node:fs/promises";
import { compareRules } from "../site/engine.mjs";

const usage = `Usage: node scripts/replay.mjs --example | --rules rules.json [--archive archive.json]
Writes a JSON report to stdout. The rules document contains ruleA and ruleB.
Each rule uses numeric lat, lon, radiusKm, minWindKt, limitUSD.
--example uses the Fort Myers opening pair. --archive selects a compatible 1990–2025 input.`;

async function loadFile(path, maxSize) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxSize)
    throw new Error("Invalid file or size limit exceeded: " + path);
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") return console.log(usage);
  let rulesFile, archiveFile;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--example" && !rulesFile)
      rulesFile = new URL("../example-rules.json", import.meta.url);
    else if (
      flag === "--rules" &&
      !rulesFile &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      rulesFile = args[++i];
    else if (
      flag === "--archive" &&
      !archiveFile &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      archiveFile = args[++i];
    else throw new Error(usage);
  }
  if (!rulesFile) throw new Error(usage);
  const [rules, archive] = await Promise.all([
    loadFile(rulesFile, 12_000_000),
    loadFile(
      archiveFile || new URL("../site/data/atlantic.json", import.meta.url),
      40_000_000,
    ),
  ]);
  const report = compareRules(archive, rules.ruleA, rules.ruleB);
  console.log(
    JSON.stringify(
      { format: "radius-clause/replay-v1", archive: archive.meta, ...report },
      null,
      2,
    ),
  );
}
main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
