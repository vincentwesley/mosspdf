// A-NET-3: response headers match tests/headers.expected.json. Runs against the local wrangler dev server, or production with BASE_URL=...
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";

const expected = JSON.parse(readFileSync(new URL("../tests/headers.expected.json", import.meta.url), "utf8")) as {
  global: Record<string, string>;
  assets: Record<string, string>;
  workers: Record<string, string>;
};

test("A-NET-3: headers on the page", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const got = res.headers();
  for (const [k, v] of Object.entries(expected.global)) expect(got[k], k).toBe(v);
});

test("A-NET-3: headers on a JS asset", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const src = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(src, "no /assets JS script in index.html").toBeTruthy();
  const res = await request.get(src!);
  expect(res.status()).toBe(200);
  const got = res.headers();
  for (const [k, v] of Object.entries({ ...expected.global, ...expected.assets })) expect(got[k], k).toBe(v);
});

test("A-NET-3: headers on the engine workers (connect-src 'none', Trusted Types)", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const entry = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const src = (await (await request.get(entry!)).text()).match(/assets\/workers\/ops\.worker-[\w-]+\.js/)?.[0];
  expect(src, "ops worker URL not found in the entry chunk").toBeTruthy();
  const res = await request.get("/" + src);
  expect(res.status()).toBe(200);
  const got = res.headers();
  for (const [k, v] of Object.entries({ ...expected.global, ...expected.workers })) expect(got[k], k).toBe(v);
});

test("A-NET-3: headers on /sw.js (when present)", async ({ request }) => {
  const res = await request.get("/sw.js");
  test.skip(res.status() !== 200 || (res.headers()["content-type"] ?? "").includes("html"), "no service worker yet");
  for (const [k, v] of Object.entries(expected.global)) expect(res.headers()[k], k).toBe(v);
});
