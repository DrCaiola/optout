// Regenerates brokers.js and statutes.js from their canonical .json files.
// The .js mirrors exist so the app works from file:// (fetch() of local JSON
// is blocked by Chromium there). Run after editing either .json file:
//   node scripts/sync-data.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pairs = [
  ["brokers.json", "brokers.js", "BROKER_DATA"],
  ["statutes.json", "statutes.js", "STATUTE_DATA"],
];

for (const [src, out, globalName] of pairs) {
  const data = JSON.parse(readFileSync(join(root, src), "utf8"));
  const banner = `// GENERATED from ${src} — do not edit by hand. Run: node scripts/sync-data.mjs\n`;
  writeFileSync(join(root, out), banner + `window.${globalName} = ${JSON.stringify(data, null, 2)};\n`);
  console.log(`wrote ${out} from ${src}`);
}
