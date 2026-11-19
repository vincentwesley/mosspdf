// Production dependency licences must be allowlisted and listed in THIRD_PARTY_NOTICES.md (A-BLD-3). Run after `npm ci`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"]);
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

// SPDX: "A OR B" passes if any is allowed, "A AND B" needs all (one level, parentheses stripped).
const ok = (expr) => {
  const e = expr.replace(/[()]/g, "").trim();
  return e.includes(" AND ") ? e.split(/\s+AND\s+/).every((p) => ALLOWED.has(p)) : e.split(/\s+OR\s+/).some((p) => ALLOWED.has(p));
};

const prod = Object.entries(lock.packages).filter(([p, v]) => p.startsWith("node_modules/") && !v.dev);
let bad = 0;
for (const [p, v] of prod) {
  const name = p.replace(/^.*node_modules\//, "");
  const pj = join(root, p, "package.json");
  const meta = existsSync(pj) ? JSON.parse(readFileSync(pj, "utf8")) : {};
  const raw = v.license ?? meta.license ?? meta.licenses;
  const lic = typeof raw === "string" ? raw : raw?.type ?? (Array.isArray(raw) ? raw.map((l) => l.type).join(" OR ") : "");
  const problems = [];
  if (!lic || !ok(lic)) problems.push(`licence "${lic || "none"}" not allowed`);
  if (!notices.includes(name)) problems.push("missing from THIRD_PARTY_NOTICES.md");
  console.log(`${problems.length ? "FAIL" : "ok  "} ${name} (${lic})${problems.length ? ": " + problems.join("; ") : ""}`);
  bad += problems.length ? 1 : 0;
}
console.log(`${prod.length} production package(s) checked, ${bad} failing`);
process.exit(bad ? 1 : 0);
