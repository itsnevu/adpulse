// Date helpers. All dates in the API are plain "YYYY-MM-DD" strings; all
// arithmetic is done in UTC to avoid timezone drift.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Inclusive day count difference: diffDays("2024-01-01", "2024-01-01") === 0
function diffDays(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// List every date string in [fromStr, toStr] inclusive.
function eachDateStr(fromStr, toStr) {
  const out = [];
  let cur = fromStr;
  while (cur <= toStr) {
    out.push(cur);
    cur = addDaysStr(cur, 1);
  }
  return out;
}

module.exports = { isValidDateStr, todayStr, addDaysStr, diffDays, eachDateStr };
