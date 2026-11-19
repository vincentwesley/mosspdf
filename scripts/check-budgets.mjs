// Fails when built output exceeds size budgets. Run after the build: `npm run check:budgets`.
// Budgets live in budgets.json beside the project root (raw bytes in KB, not gzip). Directory key `dir:<name>` sums files under any folder of that name.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const budgets = JSON.parse(readFileSync(new URL("../budgets.json", import.meta.url), "utf8"));
const KB = 1024;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sum = (fs) => fs.reduce((n, f) => n + statSync(f).size, 0);
const files = walk(dist);

let bad = false;
for (const [key, maxKb] of Object.entries(budgets)) {
  const sel = key.startsWith("dir:")
    ? files.filter((f) => f.split(/[\\/]/).includes(key.slice(4)))
    : files.filter((f) => extname(f) === key);
  const size = sum(sel);
  const over = size > maxKb * KB;
  bad ||= over;
  console.log(`${over ? "FAIL" : "ok  "} ${key}: ${(size / KB).toFixed(1)} KB / ${maxKb} KB`);
}
process.exit(bad ? 1 : 0);