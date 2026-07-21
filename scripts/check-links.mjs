// Checks every optOutUrl in brokers.json for link rot: 404/410, timeouts,
// and redirects that land on the site homepage (a common silent failure).
// 403/405/429 responses count as "reachable but bot-blocked", not broken —
// most broker sites block non-browser clients.
//   node scripts/check-links.mjs [--strict] [--json]
// --strict exits 1 if anything is broken; --json prints machine-readable output.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { brokers } = JSON.parse(readFileSync(join(root, "brokers.json"), "utf8"));
const strict = process.argv.includes("--strict");
const asJson = process.argv.includes("--json");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 20000;

async function probe(url, method) {
  const res = await fetch(url, {
    method,
    redirect: "follow",
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
}

async function check(broker) {
  const url = broker.optOutUrl;
  try {
    let res = await probe(url, "HEAD");
    if (res.status === 405 || res.status === 501 || res.status >= 500) res = await probe(url, "GET");
    const finalUrl = new URL(res.url || url);
    const originalPath = new URL(url).pathname.replace(/\/$/, "");
    const finalPath = finalUrl.pathname.replace(/\/$/, "");
    if (res.status === 404 || res.status === 410) return { id: broker.id, url, ok: false, verdict: `HTTP ${res.status}` };
    if ([401, 403, 405, 429].includes(res.status)) return { id: broker.id, url, ok: true, verdict: `HTTP ${res.status} (bot-blocked; verify in a browser)` };
    if (res.status >= 400) return { id: broker.id, url, ok: false, verdict: `HTTP ${res.status}` };
    if (originalPath !== "" && finalPath === "") return { id: broker.id, url, ok: false, verdict: `redirects to homepage (${finalUrl.origin})` };
    return { id: broker.id, url, ok: true, verdict: `HTTP ${res.status}` };
  } catch (err) {
    const reason = err.name === "TimeoutError" ? "timeout" : (err.cause?.code ?? err.message);
    return { id: broker.id, url, ok: false, verdict: String(reason) };
  }
}

const results = await Promise.all(brokers.map(check));
const broken = results.filter((r) => !r.ok);

if (asJson) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), total: results.length, broken, results }, null, 2));
} else {
  for (const r of results) console.log(`${r.ok ? "  ok  " : "BROKEN"}  ${r.id.padEnd(16)} ${r.verdict}  ${r.url}`);
  console.log(`\n${results.length} checked, ${broken.length} broken.`);
}
if (strict && broken.length) process.exit(1);
