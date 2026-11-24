// Create form: adds AcroForm fields (text, multi-line, checkbox, date, dropdown, signature area) at placed rectangles. Existing fields stay as they are.
// Positions are fractions of the displayed page (like edit.ts), turned into user space with stamp.view/toUser, so /Rotate and CropBox need no special case.
// ponytail: no JavaScript is written (no AFDate_FormatEx), so a date field is a text field with a tooltip; a signature area is a text field, not a /Sig certificate field.
import { PDFBool, PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField, PDFHexString, PDFName, StandardFonts, rgb, type PDFField } from "@cantoo/pdf-lib";
import { FIELD_NAME, WIN_ANSI } from "../core/winansi";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { toUser, view } from "./stamp";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export type NewFieldKind = "text" | "multiline" | "checkbox" | "date" | "dropdown" | "signature";
export interface NewField {
  kind: NewFieldKind;
  name: string; // [A-Za-z0-9 _-], 1 to 40 characters, unique in the file
  page: number; // 0-based
  x: number; y: number; w: number; h: number; // top-left and size, fractions of the shown page
  required?: boolean;
  size?: number; // text size in pt; 0 = automatic
  options?: string[]; // dropdown
}
export interface CreateFormInput { fields: NewField[] }

const TIPS: Partial<Record<NewFieldKind, string>> = { date: "Date, for example 31/12/2026", signature: "Sign here" };

export async function createForm(file: InFile, input: CreateFormInput, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await PDFDocument.load(p.bytes, { updateMetadata: false, preserveXFA: true });
  const bad = (m: string) => new PdfError("unsupported", m, file.name);
  if (!input.fields.length) throw bad("No fields are placed yet. Click a page to place a field, then save.");
  const form = doc.getForm();
  if (form.hasXFA()) throw bad(`"${file.name}" has an old-style (XFA) form, so fields can't be added to it. Print it to a new PDF first, or start from a plain PDF.`);
  const had = form.getFields().length > 0;
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // appearances are made per new field (after addToPage), so fields that were already there keep theirs
  const seen = new Set<string>();
  for (const [k, f] of input.fields.entries()) {
    if (k % 25 === 0) checkAbort(o.signal);
    if (!FIELD_NAME.test(f.name)) throw bad(`The field name "${f.name.slice(0, 40)}" can't be used. Use up to 40 letters, digits, spaces, dashes or underscores.`);
    if (seen.has(f.name) || form.getFieldMaybe(f.name)) throw bad(`Two fields can't share the name "${f.name}". Rename one of them.`);
    seen.add(f.name);
    if (!Number.isInteger(f.page) || f.page < 0 || f.page >= pages.length || ![f.x, f.y, f.w, f.h].every(Number.isFinite) || !(f.w > 0 && f.h > 0))
      throw bad(`The field "${f.name}" points at a page or a size that can't be used.`);
    const size = f.size ?? 12;
    if (!(size === 0 || (size >= 4 && size <= 96))) throw bad("The text size must be between 4 and 96.");
    const page = pages[f.page];
    const v = view(page);
    const [ax, ay] = toUser(v, f.x * v.w, (1 - f.y - f.h) * v.h), [bx, by] = toUser(v, (f.x + f.w) * v.w, (1 - f.y) * v.h);
    // pdf-lib grows the widget by half the border on every side, so shrink the request by that much
    const look = { x: Math.min(ax, bx) + 0.5, y: Math.min(ay, by) + 0.5, width: Math.max(1, Math.abs(bx - ax) - 1), height: Math.max(1, Math.abs(by - ay) - 1), borderWidth: 1, borderColor: rgb(0.35, 0.35, 0.35), backgroundColor: rgb(0.94, 0.97, 0.95), font };
    // the rectangle is already in user space; /MK /R turns the text upright on a rotated page (passing `rotate` to addToPage would turn the rectangle itself)
    let field: PDFField;
    if (f.kind === "checkbox") { const c = form.createCheckBox(f.name); c.addToPage(page, look); field = c; }
    else if (f.kind === "dropdown") {
      const opts = (f.options ?? []).map((s) => s.trim()).filter(Boolean);
      if (!opts.length) throw bad(`The dropdown "${f.name}" needs at least one choice.`);
      if (new Set(opts).size !== opts.length) throw bad(`The dropdown "${f.name}" lists the same choice twice.`);
      if (opts.some((s) => s.length > 100 || ![...s].every((c) => WIN_ANSI.test(c)))) throw bad(`The choices of "${f.name}" can only use Latin letters, digits and basic punctuation, up to 100 characters each.`);
      const d = form.createDropdown(f.name);
      d.addOptions(opts); d.addToPage(page, look); d.setFontSize(size); field = d;
    } else {
      const t = form.createTextField(f.name);
      if (f.kind === "multiline") t.enableMultiline();
      t.addToPage(page, look); t.setFontSize(size); field = t;
    }
    if (v.rot) for (const w of field.acroField.getWidgets()) w.getOrCreateAppearanceCharacteristics().setRotation(v.rot);
    if (field instanceof PDFCheckBox) field.updateAppearances();
    else (field as PDFTextField | PDFDropdown).updateAppearances(font);
    if (f.required) field.enableRequired();
    field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(TIPS[f.kind] ?? f.name));
  }
  if (!had) form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), name: `${safeName(file.name, "document").slice(0, -4)}-form.pdf`, warnings: p.warnings };
}
