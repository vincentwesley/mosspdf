// Pages as pictures to a minimal .pptx (zip of XML written by hand with fflate, like core/docx.ts). Pure.
import { strToU8, zipSync } from "fflate";
import { esc } from "./docx";

export interface Slide { jpeg: Uint8Array; width: number; height: number }

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NA = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NR = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NP = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CT = "application/vnd.openxmlformats-officedocument.presentationml.";
const W = 12192000; // 13.333 in
const rels = (items: [string, string][]) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([t, to], i) => `<Relationship Id="rId${i + 1}" Type="${RT}${t}" Target="${to}"/>`).join("")}</Relationships>`;
const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const clr = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const ln = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
const font = (n: string) => `<a:${n}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${n}>`;
const theme = `<a:theme ${NA} name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${clr("dk2", "44546A")}${clr("lt2", "E7E6E6")}${["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"].map((c, i) => clr(`accent${i + 1}`, c)).join("")}${clr("hlink", "0563C1")}${clr("folHlink", "954F72")}</a:clrScheme><a:fontScheme name="Office">${font("majorFont")}${font("minorFont")}</a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${ln.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/** A .pptx with one slide per page: the JPEG fills the slide (centred, aspect kept). The slide size follows the first page. */
export function buildPptx(slides: readonly Slide[]): Uint8Array {
  const H = Math.round((W * slides[0].height) / slides[0].width);
  const f = (s: string) => strToU8(HEAD + s);
  const parts: Record<string, Uint8Array> = {
    "[Content_Types].xml": f(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="${CT}presProps+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}slide+xml"/>`).join("")}</Types>`),
    "_rels/.rels": f(rels([["officeDocument", "ppt/presentation.xml"]])),
    "ppt/presentation.xml": f(`<p:presentation ${NA} ${NR} ${NP}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 4}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": f(rels([["slideMaster", "slideMasters/slideMaster1.xml"], ["theme", "theme/theme1.xml"], ["presProps", "presProps.xml"], ...slides.map((_, i): [string, string] => ["slide", `slides/slide${i + 1}.xml`])])),
    "ppt/presProps.xml": f(`<p:presentationPr ${NA} ${NR} ${NP}/>`),
    "ppt/theme/theme1.xml": f(theme),
    "ppt/slideMasters/slideMaster1.xml": f(`<p:sldMaster ${NA} ${NR} ${NP}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${grp}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": f(rels([["slideLayout", "../slideLayouts/slideLayout1.xml"], ["theme", "../theme/theme1.xml"]])),
    "ppt/slideLayouts/slideLayout1.xml": f(`<p:sldLayout ${NA} ${NR} ${NP} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${grp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": f(rels([["slideMaster", "../slideMasters/slideMaster1.xml"]])),
  };
  slides.forEach((s, i) => {
    const k = Math.min(W / s.width, H / s.height);
    const cx = Math.round(s.width * k), cy = Math.round(s.height * k);
    parts[`ppt/slides/slide${i + 1}.xml`] = f(`<p:sld ${NA} ${NR} ${NP}><p:cSld><p:spTree>${grp}<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${i + 1}" descr="${esc(`Page ${i + 1}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round((W - cx) / 2)}" y="${Math.round((H - cy) / 2)}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    parts[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = f(rels([["slideLayout", "../slideLayouts/slideLayout1.xml"], ["image", `../media/image${i + 1}.jpeg`]]));
    parts[`ppt/media/image${i + 1}.jpeg`] = s.jpeg;
  });
  return zipSync(parts, { level: 0 });
}
