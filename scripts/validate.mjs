// Validates brokers.json / statutes.json shape and checks the generated .js
// mirrors are in sync. Exits non-zero on any problem. No dependencies.
//   node scripts/validate.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const brokersDoc = JSON.parse(readFileSync(join(root, "brokers.json"), "utf8"));
const statutesDoc = JSON.parse(readFileSync(join(root, "statutes.json"), "utf8"));

const STATUSES = ["not_checked", "no_listing", "found_listing", "request_sent", "removed", "recheck_due"];
const ids = new Set();

if (!Array.isArray(brokersDoc.brokers)) errors.push("brokers.json: .brokers must be an array");
for (const b of brokersDoc.brokers ?? []) {
  const where = `broker "${b.id ?? "?"}"`;
  if (!b.id || !/^[a-z0-9-]+$/.test(b.id)) errors.push(`${where}: bad or missing id`);
  if (ids.has(b.id)) errors.push(`${where}: duplicate id`);
  ids.add(b.id);
  if (!b.name) errors.push(`${where}: missing name`);
  if (b.tier !== 1 && b.tier !== 2) errors.push(`${where}: tier must be 1 or 2`);
  if (!/^https:\/\//.test(b.optOutUrl ?? "")) errors.push(`${where}: optOutUrl must be https`);
  if (b.method !== "form" && b.method !== "email") errors.push(`${where}: method must be "form" or "email"`);
  if (b.method === "email" && !b.contactEmail) errors.push(`${where}: method "email" requires contactEmail`);
  if (b.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.contactEmail)) errors.push(`${where}: bad contactEmail`);
  if (!b.note) errors.push(`${where}: missing note`);
  if (!Array.isArray(b.cascades)) errors.push(`${where}: cascades must be an array`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.lastVerified ?? "")) errors.push(`${where}: lastVerified must be YYYY-MM-DD`);
}
for (const b of brokersDoc.brokers ?? []) {
  for (const c of b.cascades ?? []) {
    if (!ids.has(c)) errors.push(`broker "${b.id}": cascade target "${c}" is not a known broker id`);
  }
}
if (!Array.isArray(brokersDoc.meta?.statuses) || brokersDoc.meta.statuses.join() !== STATUSES.join()) {
  errors.push("brokers.json: meta.statuses must match the canonical status list");
}

if (typeof statutesDoc.statutes !== "object") errors.push("statutes.json: .statutes must be an object");
for (const [code, s] of Object.entries(statutesDoc.statutes ?? {})) {
  const where = `statute "${code}"`;
  if (!s.state || !s.law) errors.push(`${where}: missing state or law`);
  if (s.deadlineDays !== null && !Number.isInteger(s.deadlineDays)) errors.push(`${where}: deadlineDays must be an integer or null`);
}
if (!statutesDoc.statutes?.other) errors.push('statutes.json: must include the "other" fallback entry');

// Generated mirrors must match the JSON exactly.
for (const [src, out, globalName] of [["brokers.json", "brokers.js", "BROKER_DATA"], ["statutes.json", "statutes.js", "STATUTE_DATA"]]) {
  const data = JSON.parse(readFileSync(join(root, src), "utf8"));
  const expected = `window.${globalName} = ${JSON.stringify(data, null, 2)};`;
  let actual = "";
  try { actual = readFileSync(join(root, out), "utf8"); } catch { errors.push(`${out}: missing — run node scripts/sync-data.mjs`); continue; }
  if (!actual.includes(expected)) errors.push(`${out}: out of sync with ${src} — run node scripts/sync-data.mjs`);
}

if (errors.length) {
  console.error(`FAIL — ${errors.length} problem(s):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`OK — ${ids.size} brokers, ${Object.keys(statutesDoc.statutes).length} statute entries, mirrors in sync.`);
