// Runs every automated acceptance check and prints ID | status (IDs from docs/ACCEPTANCE.md). Exit 1 on any failure.
// Usage: node scripts/acceptance.mjs [--no-install]. Tests map to IDs by `A-XXX-n` in their title.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "qa-output");
mkdirSync(out, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } }).status === 0;

const status = new Map(); // ID -> PASS | FAIL | SKIP
const mark = (id, s) => status.set(id, status.get(id) === "FAIL" || s === "FAIL" ? "FAIL" : status.get(id) === "PASS" && s === "SKIP" ? "PASS" : s);
const step = (id, label, ok) => {
  console.log(`\n== ${label}: ${ok ? "ok" : "FAILED"}`);
  mark(id, ok ? "PASS" : "FAIL");
};

const ids = [...readFileSync(join(root, "docs", "ACCEPTANCE.md"), "utf8").matchAll(/^- (A-[A-Z]+-\d+)( \(M\))?/gm)].map((m) => [m[1], !!m[2]]);

if (!process.argv.includes("--no-install")) step("A-BLD-1", "npm ci", run(npm, ["ci", "--ignore-scripts"]));
step("A-BLD-1", "check", run(npm, ["run", "check"]));
step("A-BLD-2", "audit", run(npm, ["audit", "--omit=dev", "--audit-level=high"]));
step("A-BLD-3", "licences", run(npm, ["run", "licences"]));

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const installScripts = ["preinstall", "install", "postinstall", "prepare"].filter((k) => pkg.scripts?.[k]);
const tracked = spawnSync("git", ["ls-files", ".claude/settings.json"], { cwd: root, encoding: "utf8" }).stdout.trim();
console.log(`\n== hygiene: install scripts [${installScripts}] tracked .claude/settings.json [${tracked}]`);
mark("A-BLD-4", installScripts.length || tracked ? "FAIL" : "PASS"); // gitleaks stays a pre-commit hook, not run here

step("A-BLD-5", "budgets", run(npm, ["run", "check:budgets"]));

// Unit + e2e with JSON reporters.
const unitJson = join(out, "vitest.json");
const e2eJson = join(out, "playwright.json");
run(npm, ["exec", "--", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${unitJson}`]);
run(npm, ["run", "test:e2e", "--", "--reporter=list,json"], { PLAYWRIGHT_JSON_OUTPUT_FILE: e2eJson });

const tag = (title, s) => {
  for (const [id] of ids) if (title.includes(id)) mark(id, s);
};
if (existsSync(unitJson)) {
  for (const f of JSON.parse(readFileSync(unitJson, "utf8")).testResults)
    for (const t of f.assertionResults) tag(t.fullName ?? t.title, t.status === "passed" ? "PASS" : t.status === "failed" ? "FAIL" : "SKIP");
}
if (existsSync(e2eJson)) {
  const walk = (s) => {
    for (const sp of s.specs ?? []) {
      const results = sp.tests.map((t) => t.status); // expected | unexpected | skipped | flaky
      tag(sp.title, results.includes("unexpected") ? "FAIL" : results.every((r) => r === "skipped") ? "SKIP" : "PASS");
    }
    (s.suites ?? []).forEach(walk);
  };
  JSON.parse(readFileSync(e2eJson, "utf8")).suites.forEach(walk);
} else {
  for (const [id] of ids) if (id.startsWith("A-E2E") || id.startsWith("A-NET")) mark(id, "FAIL");
}

console.log("\nID          | status");
console.log("------------|-------");
let failed = false;
for (const [id, manual] of ids) {
  const s = status.get(id) ?? (manual ? "manual" : "no test yet");
  failed ||= s === "FAIL";
  console.log(`${id.padEnd(11)} | ${s}`);
}
process.exit(failed ? 1 : 0);
