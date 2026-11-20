// Every tool, in home order. Adding a tool: create src/tools/<id>.ts exporting a ToolDef, then import it and add it to TOOLS.
import { GROUPS, type GroupName, type ToolDef } from "./types";
import { merge } from "./merge";
import { split } from "./split";
import { organize } from "./organize";
import { extract } from "./extract";
import { imagesToPdf } from "./images-to-pdf";
import { pdfToImages } from "./pdf-to-images";
import { compress } from "./compress";
import { pageNumbers } from "./page-numbers";
import { watermark } from "./watermark";
import { metadata } from "./metadata";
import { protect } from "./protect";
import { unprotect } from "./unprotect";
import { safetyScan } from "./safety-scan";
import { repair } from "./repair";
import { fill } from "./fill";
import { sign } from "./sign";
import { ocr } from "./ocr";
import { redact } from "./redact";
import { photo } from "./photo";
import { compare } from "./compare";

export const TOOLS: ToolDef[] = [merge, split, organize, extract, imagesToPdf, pdfToImages, compress, pageNumbers, watermark, metadata, protect, unprotect, safetyScan, repair, fill, sign, ocr, redact, photo, compare];

export const toolById = (id: string): ToolDef | undefined => TOOLS.find((t) => t.id === id);
/** Live = has a `run`; the others are planned and shown as "Coming soon". */
export const isLive = (t: ToolDef) => !!t.run;
export const LIVE = TOOLS.filter(isLive);
/** Home map: every group that has a tool, in GROUPS order. */
export const CATALOG: { name: GroupName; tools: ToolDef[] }[] = GROUPS.map((name) => ({ name, tools: TOOLS.filter((t) => t.group === name) })).filter((g) => g.tools.length);

const DEFAULT_NEXT = ["compress", "protect", "page-numbers", "watermark", "organize"];
/** Live tools to suggest after `tool` produced a PDF (its `next` list, else the default), never the tool itself. */
export const nextTools = (tool: ToolDef): ToolDef[] =>
  (tool.next ?? DEFAULT_NEXT).filter((id) => id !== tool.id).map(toolById).filter((t): t is ToolDef => !!t && isLive(t)).slice(0, 5);