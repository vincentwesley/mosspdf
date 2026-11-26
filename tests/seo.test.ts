import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools/index";
import { seoFiles } from "../seo";

const files = seoFiles(["/assets/index-x.css"]);
const pages = Object.entries(files).filter(([k]) => k.endsWith("index.html"));

describe("seo pages", () => {
  it("every tool has a page, plus help", () => {
    for (const t of TOOLS) expect(files[`tools/${t.id}/index.html`], t.id).toBeTruthy();
    expect(files["help/index.html"]).toBeTruthy();
    expect(pages.length).toBe(TOOLS.length + 1);
  });
  it("titles are unique", () => {
    const titles = pages.map(([, h]) => /<title>(.*?)<\/title>/.exec(h)![1]);
    expect(new Set(titles).size).toBe(titles.length);
  });
  it("no script except theme-init and ld+json", () => {
    for (const [k, h] of pages) {
      const tags = h.match(/<script[^>]*>/g) ?? [];
      for (const s of tags) expect(s === '<script src="/theme-init.js">' || s === '<script type="application/ld+json">', `${k}: ${s}`).toBe(true);
    }
  });
  it("internal links resolve; open button goes to the app route", () => {
    const known = new Set(["/", "/help/", "/licences.txt", "/#/privacy", ...TOOLS.map((t) => `/tools/${t.id}/`), ...TOOLS.map((t) => `/#/${t.id}`)]);
    for (const [k, h] of pages) for (const m of h.matchAll(/href="(\/[^"]*)"/g)) if (!/^\/(assets|icons)\//.test(m[1]) && m[1] !== "/sitemap.xml") expect(known.has(m[1]), `${k} -> ${m[1]}`).toBe(true);
    expect(files["tools/merge/index.html"]).toContain('href="/#/merge">Open Merge<');
  });
  it("sitemap lists every page; robots links it", () => {
    for (const [k] of pages) expect(files["sitemap.xml"]).toContain(`https://mosspdf.pages.dev/${k.replace("index.html", "")}</loc>`);
    expect(files["robots.txt"]).toContain("Sitemap: https://mosspdf.pages.dev/sitemap.xml");
  });
});
