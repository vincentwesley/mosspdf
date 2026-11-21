// Runs the Playwright CLI with project-local browsers (PLAYWRIGHT_BROWSERS_PATH=0 = node_modules/playwright-core/.local-browsers).
// `--prod` as first arg points BASE_URL at production (the config then skips the local web server).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" };
if (args[0] === "--prod") {
  args.shift();
  env.BASE_URL ||= "https://mosspdf.pages.dev";
}
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
process.exit(spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env }).status ?? 1);
