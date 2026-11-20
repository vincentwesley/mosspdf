// Minimal XMP packet editing for the few properties that mirror the Info dictionary. String based on purpose: no XML parser in the worker.
export type XmpKey = "dc:title" | "dc:creator" | "dc:description" | "pdf:Keywords" | "pdf:Producer" | "xmp:CreatorTool";
const NS: Record<string, string> = { dc: "http://purl.org/dc/elements/1.1/", pdf: "http://ns.adobe.com/pdf/1.3/", xmp: "http://ns.adobe.com/xap/1.0/" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export function xmpGet(xml: string, q: XmpKey): string | undefined {
  const el = new RegExp(`<${q}(?=[\\s>])[^>]*>([\\s\\S]*?)</${q}>`).exec(xml);
  if (el) {
    const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(el[1]);
    return unesc((li ? li[1] : el[1]).trim());
  }
  const at = new RegExp(`\\s${q}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(xml);
  return at ? unesc(at[1] ?? at[2]) : undefined;
}

/** value null/"" removes the property. Only edits an existing packet; never creates one. */
export function xmpSet(xml: string, q: XmpKey, value: string | null): string {
  let out = xml
    .replace(new RegExp(`<${q}(?=[\\s>/])[^>]*?(?:/>|>[\\s\\S]*?</${q}>)`, "g"), "")
    .replace(new RegExp(`\\s${q}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "g"), "");
  if (!value) return out;
  const v = esc(value);
  const body =
    q === "dc:title" || q === "dc:description" ? `<rdf:Alt><rdf:li xml:lang="x-default">${v}</rdf:li></rdf:Alt>` : q === "dc:creator" ? `<rdf:Seq><rdf:li>${v}</rdf:li></rdf:Seq>` : v;
  const prefix = q.split(":")[0];
  const decl = out.includes(`xmlns:${prefix}=`) ? "" : ` xmlns:${prefix}="${NS[prefix]}"`;
  const m = /<rdf:Description\b([^>]*?)(\/?)>/.exec(out);
  if (!m) return xml; // nowhere to put it: leave the packet alone rather than break it
  const el = `<${q}>${body}</${q}>`;
  const open = `<rdf:Description${m[1]}${decl}`;
  out = out.slice(0, m.index) + (m[2] ? `${open}>${el}</rdf:Description>` : `${open}>${el}`) + out.slice(m.index + m[0].length);
  return out;
}
