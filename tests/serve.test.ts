import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let dir: string, proc: ChildProcess, port: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pagehold-serve-"));
  copyFileSync(resolve("scripts/serve.mjs"), join(dir, "serve.mjs"));
  mkdirSync(join(dir, "assets/workers"), { recursive: true });
  writeFileSync(join(dir, "_headers"), "/*\n  X-Test: global\n  Content-Security-Policy: default-src 'self'\n\n/assets/workers/*\n  Content-Security-Policy: default-src 'none'\n");
  writeFileSync(join(dir, "index.html"), "<p>home</p>");
  writeFileSync(join(dir, "404.html"), "<p>nope</p>");
  writeFileSync(join(dir, "assets/workers/a.wasm"), "\0asm");
  writeFileSync(join(dir, "assets/x.gz"), "gz");
  proc = spawn(process.execPath, [join(dir, "serve.mjs"), "--port", "0"]);
  port = await new Promise<number>((ok, fail) => {
    proc.stdout!.on("data", (d: Buffer) => { const m = /:(\d+)\//.exec(String(d)); if (m) ok(Number(m[1])); });
    proc.on("exit", () => fail(new Error("serve.mjs exited")));
  });
});
afterAll(async () => { const done = new Promise((ok) => proc.once("exit", ok)); proc.kill(); await done; rmSync(dir, { recursive: true, force: true }); });

// Raw request so the path reaches the server unnormalised.
const get = (path: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((ok, fail) => {
  request({ host: "127.0.0.1", port, path }, (r) => { let body = ""; r.on("data", (c) => (body += c)); r.on("end", () => ok({ status: r.statusCode!, headers: r.headers, body })); }).on("error", fail).end();
});

it("serves index with _headers applied", async () => {
  const r = await get("/");
  expect(r.status).toBe(200);
  expect(r.body).toBe("<p>home</p>");
  expect(r.headers["x-test"]).toBe("global");
});
it("merges matching rules like Cloudflare", async () => {
  expect((await get("/assets/workers/a.wasm")).headers["content-security-policy"]).toBe("default-src 'self',default-src 'none'");
});
it("MIME types", async () => {
  expect((await get("/assets/workers/a.wasm")).headers["content-type"]).toBe("application/wasm");
  const gz = (await get("/assets/x.gz")).headers;
  expect(gz["content-type"]).toBe("application/gzip");
  expect(gz["content-encoding"]).toBeUndefined();
});
it("blocks path traversal", async () => {
  for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/%2e%2e%2f%2e%2e%2fetc/passwd"]) {
    const r = await get(p);
    expect([400, 404], p).toContain(r.status);
    expect(r.body).not.toContain('"name"');
  }
});
it("unknown path and _headers give 404.html", async () => {
  for (const p of ["/missing", "/_headers"]) {
    const r = await get(p);
    expect(r.status).toBe(404);
    expect(r.body).toBe("<p>nope</p>");
  }
});
