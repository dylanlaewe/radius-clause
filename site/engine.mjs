const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;
const START = 1990;
const validStatuses = new Set([
  "TD",
  "TS",
  "HU",
  "EX",
  "SD",
  "SS",
  "LO",
  "WV",
  "DB",
]);
const END = 2025;
const ruleLimits = {
  lat: [-90, 90],
  lon: [-180, 180],
  radiusKm: [0, 20016],
  minWindKt: [0, 250],
  limitUSD: [0, 1_000_000_000],
};

export function validateRule(rule) {
  if (!rule || typeof rule !== "object")
    throw new TypeError("A numeric rule is required.");
  const normalized = {};
  for (const [key, [min, max]] of Object.entries(ruleLimits)) {
    const value = rule[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(
        key + " must be a finite number from " + min + " through " + max + ".",
      );
    }
    normalized[key] = value;
  }
  if (Math.round(rule.limitUSD * 100) / 100 !== rule.limitUSD) {
    throw new RangeError("limitUSD must have at most two decimal places.");
  }
  return normalized;
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) *
      Math.cos(lat2 * RAD) *
      Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  const clamped = Math.max(0, Math.min(1, a));
  return 2 * EARTH_KM * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function checkStorm(storm) {
  if (
    !storm ||
    typeof storm.id !== "string" ||
    !/^AL\d{6}$/.test(storm.id) ||
    !Number.isInteger(storm.year) ||
    Number(storm.id.slice(-4)) !== storm.year ||
    storm.year < START ||
    storm.year > END ||
    typeof storm.name !== "string" ||
    !storm.name.length ||
    !Array.isArray(storm.points) ||
    !storm.points.length ||
    storm.points.length > 10000
  )
    throw new TypeError("Invalid Atlantic storm record.");
  for (const point of storm.points) {
    if (!Array.isArray(point) || point.length !== 5)
      throw new TypeError("Invalid observation in " + storm.id);
    const [time, lat, lon, wind, status] = point;
    if (
      typeof time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/.test(time) ||
      !Number.isFinite(Date.parse(time)) ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180 ||
      !Number.isFinite(wind) ||
      wind < 0 ||
      wind > 250 ||
      typeof status !== "string" ||
      !validStatuses.has(status)
    )
      throw new TypeError("Invalid observation in " + storm.id);
  }
}

function score(storm, rule) {
  let strongest = null;
  let closestIntense = null;
  for (const [time, lat, lon, windKt, status] of storm.points) {
    if ((status !== "HU" && status !== "TS") || windKt < rule.minWindKt)
      continue;
    const distance = distanceKm(rule.lat, rule.lon, lat, lon);
    const fix = { time, lat, lon, windKt, status, distanceKm: distance };
    if (
      !closestIntense ||
      distance < closestIntense.distanceKm ||
      (distance === closestIntense.distanceKm &&
        (windKt > closestIntense.windKt ||
          (windKt === closestIntense.windKt && time < closestIntense.time)))
    )
      closestIntense = fix;
    if (
      distance <= rule.radiusKm &&
      (!strongest ||
        windKt > strongest.windKt ||
        (windKt === strongest.windKt &&
          (distance < strongest.distanceKm ||
            (distance === strongest.distanceKm && time < strongest.time))))
    )
      strongest = fix;
  }
  return {
    triggered: strongest !== null,
    payoutUSD: strongest ? rule.limitUSD : 0,
    strongest,
    closestIntense,
    minTriggerRadiusKm: closestIntense?.distanceKm ?? null,
    distanceMarginKm: closestIntense
      ? rule.radiusKm - closestIntense.distanceKm
      : null,
  };
}

export function evaluateStorm(storm, rule) {
  checkStorm(storm);
  return score(storm, validateRule(rule));
}

export function compareRules(archive, a, b) {
  const ruleA = validateRule(a);
  const ruleB = validateRule(b);
  if (!Array.isArray(archive?.storms) || archive.storms.length > 10000)
    throw new TypeError("Expected an Atlantic storm archive.");
  const annual = Array.from({ length: END - START + 1 }, (_, offset) => ({
    year: START + offset,
    countA: 0,
    countB: 0,
    payoutAUSD: 0,
    payoutBUSD: 0,
  }));
  const summary = {
    storms: archive.storms.length,
    matchedA: 0,
    matchedB: 0,
    both: 0,
    aOnly: 0,
    bOnly: 0,
    neither: 0,
    yearsTriggeredA: 0,
    yearsTriggeredB: 0,
    payoutAUSD: 0,
    payoutBUSD: 0,
  };
  const ids = new Set();
  const rows = archive.storms.map((storm) => {
    checkStorm(storm);
    if (ids.has(storm.id)) throw new TypeError("Duplicate storm " + storm.id);
    ids.add(storm.id);
    const a = score(storm, ruleA);
    const b = score(storm, ruleB);
    let change = "neither";
    if (a.triggered && b.triggered) change = "both";
    else if (a.triggered) change = "a-only";
    else if (b.triggered) change = "b-only";
    const key = {
      "a-only": "aOnly",
      "b-only": "bOnly",
      both: "both",
      neither: "neither",
    }[change];
    summary[key]++;
    const season = annual[storm.year - START];
    season.countA += Number(a.triggered);
    season.countB += Number(b.triggered);
    return { id: storm.id, name: storm.name, year: storm.year, a, b, change };
  });
  const centsA = Math.round(ruleA.limitUSD * 100);
  const centsB = Math.round(ruleB.limitUSD * 100);
  for (const season of annual) {
    season.payoutAUSD = (season.countA * centsA) / 100;
    season.payoutBUSD = (season.countB * centsB) / 100;
    summary.matchedA += season.countA;
    summary.matchedB += season.countB;
    summary.yearsTriggeredA += Number(season.countA > 0);
    summary.yearsTriggeredB += Number(season.countB > 0);
  }
  summary.payoutAUSD = (summary.matchedA * centsA) / 100;
  summary.payoutBUSD = (summary.matchedB * centsB) / 100;
  return {
    method:
      "HURDAT2 recorded HU/TS fixes, inclusive great-circle radius and wind, binary per storm v1",
    period: { startYear: START, endYear: END, years: annual.length },
    ruleA,
    ruleB,
    rows,
    annual,
    summary,
  };
}
