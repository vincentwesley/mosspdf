// Basic accessibility check, read from qpdf's JSON dump (same approach as the safety scan). It looks at the signals a screen reader
// and a PDF viewer rely on. It is NOT a PDF/UA validation and says so.
import { classify, openPdf } from "./open";
import type { Engines, InFile } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- qpdf JSON v2 is untyped */
type J = any;

export type A11yStatus = "pass" | "warn" | "fail";
export interface A11yCheck {
  id: "tagged" | "language" | "title" | "figures" | "fonts" | "text" | "bookmarks";
  label: string;
  status: A11yStatus;
  detail: string;
  /** One plain line on what to do; absent when the check passed. */
  fix?: string;
}
export interface A11yReport {
  checks: A11yCheck[];
  pageCount: number;
  repaired: boolean;
}

const REF = /^\d+ 0 R$/;
const str = (v: unknown): string => {
  if (typeof v !== "string") return "";
  if (v.startsWith("u:")) return v.slice(2);
  if (v.startsWith("b:")) return v.slice(2).replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
  return "";
};

function analyse(j: J, pageCount: number): A11yCheck[] {
  const objs: J = j.qpdf[1];
  const dictOf = (o: J): J => o?.value ?? o?.stream?.dict;
  const deref = (v: J): J => (typeof v === "string" && REF.test(v) ? dictOf(objs[`obj:${v}`]) : v);
  const root = deref(objs.trailer.value["/Root"]) ?? {};
  const info = deref(objs.trailer.value["/Info"]) ?? {};

  const tree = deref(root["/StructTreeRoot"]);
  const marked = deref(root["/MarkInfo"])?.["/Marked"] === true;
  const tagged: A11yCheck = tree && marked
    ? { id: "tagged", label: "Tagged structure", status: "pass", detail: "The file has tags, so screen readers can follow headings, lists and reading order." }
    : tree
      ? { id: "tagged", label: "Tagged structure", status: "warn", detail: "The file has a tag tree but is not marked as tagged, so some readers ignore it.", fix: "Re-export it from the program that made it with accessibility or tags turned on." }
      : { id: "tagged", label: "Tagged structure", status: "fail", detail: "The file has no tags. Screen readers have no headings or reading order to follow.", fix: "Re-export it from the program that made it with tags turned on (in Word: Save as PDF, Options, Document structure tags)." };

  const lang = str(root["/Lang"]).trim();
  const language: A11yCheck = lang
    ? { id: "language", label: "Document language", status: "pass", detail: `Language is set to ${lang}.` }
    : { id: "language", label: "Document language", status: "fail", detail: "No language is set, so a screen reader may read it in the wrong voice.", fix: "Set the document language in the program that made the file, then export again." };

  const title = str(info["/Title"]).trim();
  const showTitle = deref(root["/ViewerPreferences"])?.["/DisplayDocTitle"] === true;
  const titleCheck: A11yCheck = !title
    ? { id: "title", label: "Title", status: "fail", detail: "No title is stored, so viewers show the file name instead.", fix: "Add one with the Metadata tool, and tick Show document title in your editor's PDF settings." }
    : showTitle
      ? { id: "title", label: "Title", status: "pass", detail: `The title is "${title}" and viewers show it.` }
      : { id: "title", label: "Title", status: "warn", detail: `The title is "${title}" but viewers are not told to show it.`, fix: "Tick Show document title in your editor's PDF settings and export again." };

  let figs = 0, withAlt = 0;
  for (const k of Object.keys(objs)) {
    if (!k.startsWith("obj:")) continue;
    const d = dictOf(objs[k]);
    if (d?.["/S"] !== "/Figure" || (d["/Type"] !== undefined && d["/Type"] !== "/StructElem")) continue;
    figs++;
    if (str(d["/Alt"]).trim()) withAlt++;
  }
  const figures: A11yCheck = !tree
    ? { id: "figures", label: "Picture descriptions", status: "warn", detail: "Not checked: without tags there is nowhere to put picture descriptions.", fix: "Fix the tags first." }
    : !figs
      ? { id: "figures", label: "Picture descriptions", status: "pass", detail: "No tagged pictures found." }
      : withAlt === figs
        ? { id: "figures", label: "Picture descriptions", status: "pass", detail: `All ${figs} pictures have a description.` }
        : { id: "figures", label: "Picture descriptions", status: "fail", detail: `${figs - withAlt} of ${figs} pictures have no description (alt text).`, fix: "Add alt text to each picture in the program that made the file, or mark decorative ones as artifacts." };

  // Fonts and text, per page (resources can be inherited from the page tree).
  const fontsOf = (page: J): J => {
    for (let d = deref(page), n = 0; d && n < 50; d = deref(d["/Parent"]), n++) {
      const r = deref(d["/Resources"]);
      if (r) return deref(r["/Font"]);
    }
    return undefined;
  };
  const seen = new Set<string>();
  const loose: string[] = [];
  let withText = 0;
  for (const p of j.pages as J[]) {
    const fonts = fontsOf(p.object);
    if (!fonts || !Object.keys(fonts).length) continue;
    withText++;
    for (const v of Object.values(fonts) as J[]) {
      const key = typeof v === "string" ? v : JSON.stringify(v);
      if (seen.has(key)) continue;
      seen.add(key);
      let f = deref(v);
      if (!f) continue;
      const name = String(f["/BaseFont"] ?? "unnamed").slice(1).replace(/^[A-Z]{6}\+/, "");
      if (f["/Subtype"] === "/Type3") continue; // glyphs are drawn in the file itself
      if (f["/Subtype"] === "/Type0") f = deref(deref(f["/DescendantFonts"])?.[0]) ?? f;
      const fd = deref(f["/FontDescriptor"]);
      if (!fd || !(fd["/FontFile"] || fd["/FontFile2"] || fd["/FontFile3"])) loose.push(name);
    }
  }
  const fonts: A11yCheck = !seen.size
    ? { id: "fonts", label: "Embedded fonts", status: "pass", detail: "No fonts to check." }
    : loose.length
      ? { id: "fonts", label: "Embedded fonts", status: "warn", detail: `${loose.length} of ${seen.size} fonts are not stored in the file (${loose.slice(0, 5).join(", ")}${loose.length > 5 ? ", and more" : ""}). Other devices may show or read the text differently.`, fix: "Export again with Embed all fonts turned on." }
      : { id: "fonts", label: "Embedded fonts", status: "pass", detail: `All ${seen.size} fonts are stored in the file.` };

  // ponytail: "has a font" stands in for "has real text"; decoding every content stream would be slow. Upgrade if scans with fonts slip through.
  const text: A11yCheck = withText === pageCount
    ? { id: "text", label: "Real text", status: "pass", detail: "Every page has text that can be selected and read aloud." }
    : withText === 0
      ? { id: "text", label: "Real text", status: "fail", detail: "No text found. This looks like a scan, which a screen reader sees as pictures.", fix: "Run it through the OCR tool to add a text layer." }
      : { id: "text", label: "Real text", status: "warn", detail: `${pageCount - withText} of ${pageCount} pages have no text and may be scans.`, fix: "Run it through the OCR tool to add a text layer." };

  const outlined = !!deref(root["/Outlines"])?.["/First"];
  const bookmarks: A11yCheck = pageCount <= 20
    ? { id: "bookmarks", label: "Bookmarks", status: "pass", detail: `Not needed for ${pageCount} ${pageCount === 1 ? "page" : "pages"}.` }
    : outlined
      ? { id: "bookmarks", label: "Bookmarks", status: "pass", detail: "The file has bookmarks to jump between sections." }
      : { id: "bookmarks", label: "Bookmarks", status: "warn", detail: `A ${pageCount}-page file should have bookmarks, and this one has none.`, fix: "Use heading styles in the source document and export with bookmarks on." };

  return [tagged, language, titleCheck, figures, fonts, text, bookmarks];
}

async function dump(f: InFile, e: Engines): Promise<{ j?: J; err: string }> {
  const run = await e.qpdf(["--json=2", "--json-key=qpdf", "--json-key=pages", ...(f.password ? [`--password=${f.password}`] : []), "/f.pdf"], { "/f.pdf": f.bytes });
  if (!run.stdout.startsWith("{")) return { err: run.stderr };
  try { return { j: JSON.parse(run.stdout), err: "" }; } catch { return { err: run.stderr || "unreadable" }; }
}

export async function accessibilityCheck(file: InFile, e: Engines): Promise<A11yReport> {
  let repaired = false;
  let d = await dump(file, e);
  if (!d.j) {
    if (/invalid password/i.test(d.err)) throw classify(d.err, file);
    const opened = await openPdf(file, e);
    d = await dump({ name: file.name, bytes: opened.bytes }, e);
    repaired = true;
    if (!d.j) throw classify(d.err, file);
  }
  const pageCount = d.j.pages.length;
  return { checks: analyse(d.j, pageCount), pageCount, repaired };
}
