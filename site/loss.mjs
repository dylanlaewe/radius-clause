// Blanks in the historical loss record mean unknown. Only explicitly entered observations are scored.
export function parseLosses(input, validIds) {
  if (typeof input !== "string" || input.length > 100000)
    throw new Error("Use at most 100,000 characters of loss records.");
  const lines = input.trim().split(/\r?\n/);
  if (lines[0].trim().toLowerCase() === "storm_id,loss_usd") lines.shift();
  const values = new Map();
  for (const [offset, line] of lines.entries()) {
    if (!line.trim()) continue;
    const cells = line.split(",").map((s) => s.trim());
    const [id, amount] = cells;
    if (cells.length !== 2 || !validIds.has(id))
      throw new Error(
        "Unknown storm ID or invalid CSV row " +
          (offset + 1) +
          ". Use the NOAA ID from the event ledger.",
      );
    if (values.has(id))
      throw new Error(
        "Duplicate loss for " + id + ". Enter a single site total per storm.",
      );
    if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(amount))
      throw new Error(
        "Enter a nonnegative USD amount for " +
          id +
          " under $10 billion without currency signs or grouping commas.",
      );
    values.set(id, Number(amount));
  }
  if (!values.size) throw new Error("Enter at least one storm ID and loss.");
  return values;
}

export function scoreLosses(report, values) {
  const rows = report.rows
    .filter((row) => values.has(row.id))
    .map((row) => {
      const lossUSD = values.get(row.id);
      const gap = (payout) => ({
        uncoveredUSD: Math.max(0, lossUSD - payout),
        excessUSD: Math.max(0, payout - lossUSD),
      });
      return {
        id: row.id,
        lossUSD,
        a: gap(row.a.payoutUSD),
        b: gap(row.b.payoutUSD),
      };
    });
  function total(rule, key) {
    return (
      rows.reduce((cents, row) => cents + Math.round(row[rule][key] * 100), 0) /
      100
    );
  }
  return {
    observedStorms: rows.length,
    unreportedStorms: report.rows.length - rows.length,
    a: {
      uncoveredUSD: total("a", "uncoveredUSD"),
      excessUSD: total("a", "excessUSD"),
    },
    b: {
      uncoveredUSD: total("b", "uncoveredUSD"),
      excessUSD: total("b", "excessUSD"),
    },
    rows,
  };
}
