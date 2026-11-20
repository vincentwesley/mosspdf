// Reading and filling AcroForm fields. Text goes in with Helvetica (WinAnsi only, like the stamp ops): other characters get a plain error.
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, StandardFonts, type PDFDict } from "@cantoo/pdf-lib";
import { safeName } from "./assemble";
import { prepare } from "./common";
import { applyCredit } from "./metadata";
import { checkAbort } from "./open";
import { PdfError, type Engines, type InFile, type OpOptions, type OpResult } from "./types";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "optionlist" | "signature" | "button";
export type FieldValue = string | boolean | string[];
export interface FormWidget {
  page: number; // 0-based; -1 when the widget is not on a page
  rect: [x0: number, y0: number, x1: number, y1: number]; // PDF user space, x0 < x1, y0 < y1
  onValue?: string; // radio: the option this widget selects
}
export interface FormField {
  name: string;
  type: FieldType;
  value: FieldValue; // text: string, checkbox: boolean, radio/dropdown: string, optionlist: string[]
  options?: string[];
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  maxLength?: number;
  widgets: FormWidget[];
}
export interface FormInfo {
  fields: FormField[];
  hasXFA: boolean;
  signed: boolean;
}
export type FormValues = Record<string, FieldValue>;

/** ponytail: scans plain bytes only; a signature dictionary inside a compressed object stream is not seen (the safety warning from `prepare` still covers /FT /Sig). */
const looksSigned = (bytes: Uint8Array) => {
  const s = new TextDecoder("latin1").decode(bytes);
  return /\/ByteRange\s*\[/.test(s) && /\/Sig\b/.test(s);
};

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false, preserveXFA: true });

export async function readForm(file: InFile, o: Pick<OpOptions, "signal">, e: Engines): Promise<FormInfo> {
  const p = await prepare(file, o, e);
  const doc = await load(p.bytes);
  const form = doc.getForm();
  const hasXFA = form.hasXFA();
  const pageOf = new Map<PDFDict, number>();
  doc.getPages().forEach((page, i) => page.node.Annots()?.asArray().forEach((r) => { const d = doc.context.lookup(r); if (d) pageOf.set(d as PDFDict, i); }));
  const fields: FormField[] = [];
  for (const f of form.getFields()) {
    let type: FieldType | undefined, value: FieldValue = "", options: string[] | undefined, multiline = false, maxLength: number | undefined;
    if (f instanceof PDFTextField) { type = "text"; value = f.getText() ?? ""; multiline = f.isMultiline(); maxLength = f.getMaxLength(); }
    else if (f instanceof PDFCheckBox) { type = "checkbox"; value = f.isChecked(); }
    else if (f instanceof PDFRadioGroup) { type = "radio"; value = f.getSelected() ?? ""; options = f.getOptions(); }
    else if (f instanceof PDFDropdown) { type = "dropdown"; value = f.getSelected()[0] ?? ""; options = f.getOptions(); }
    else if (f instanceof PDFOptionList) { type = "optionlist"; value = f.getSelected(); options = f.getOptions(); }
    else if (f instanceof PDFSignature) type = "signature";
    else type = "button";
    fields.push({
      name: f.getName(), type, value, options, readOnly: f.isReadOnly(), required: f.isRequired(), multiline, maxLength,
      widgets: f.acroField.getWidgets().map((w, k, all) => {
        const r = w.getRectangle();
        return {
          page: pageOf.get(w.dict) ?? -1,
          rect: [Math.min(r.x, r.x + r.width), Math.min(r.y, r.y + r.height), Math.max(r.x, r.x + r.width), Math.max(r.y, r.y + r.height)],
          onValue: type === "radio" ? (options?.length === all.length ? options[k] : w.getOnValue()?.decodeText()) : undefined,
        };
      }),
    });
  }
  return { fields, hasXFA, signed: looksSigned(p.bytes) };
}

export async function fillForm(file: InFile, values: FormValues, opts: { flatten?: boolean }, o: OpOptions, e: Engines): Promise<OpResult> {
  const p = await prepare(file, o, e);
  const doc = await load(p.bytes);
  const form = doc.getForm();
  const hadXFA = form.hasXFA();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ok = new Set(font.getCharacterSet());
  const warnings = [...p.warnings];
  const bad = (name: string, why: string) => new PdfError("unsupported", `The field "${name}" can't take that value: ${why}`, file.name);
  for (const [name, v] of Object.entries(values)) {
    checkAbort(o.signal);
    const f = form.getFieldMaybe(name);
    if (!f) throw bad(name, "it isn't in this form.");
    if (f.isReadOnly()) continue;
    try {
      if (f instanceof PDFTextField) {
        const text = String(v);
        const odd = [...new Set([...text])].filter((c) => c !== "\n" && c !== "\r" && !ok.has(c.codePointAt(0)!));
        if (odd.length) throw new PdfError("unsupported", `This form can't take characters like ${odd.slice(0, 3).map((c) => `"${c}"`).join(" ")} yet. Use Western European letters, digits and basic punctuation.`, file.name);
        if (text) f.setText(text); else f.setText(undefined);
      } else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
      else if (f instanceof PDFRadioGroup) { if (v) f.select(String(v)); else f.clear(); }
      else if (f instanceof PDFDropdown) f.select(v === "" ? [] : (v as string | string[]));
      else if (f instanceof PDFOptionList) f.select(v as string[]);
    } catch (err) {
      throw err instanceof PdfError ? err : bad(name, err instanceof Error ? err.message : "check the value and try again.");
    }
  }
  try {
    form.updateFieldAppearances(font);
    if (opts.flatten) form.flatten({ updateFieldAppearances: false });
  } catch {
    throw new PdfError("unsupported", "This form can't take some of those characters yet. Use Western European letters, digits and basic punctuation.", file.name);
  }
  if (hadXFA) {
    form.deleteXFA();
    warnings.push({ code: "xfa-removed", message: "This form also had XFA data. It was removed, so the filled-in standard fields are what readers will show." });
  }
  if (o.producerCredit) applyCredit(doc);
  return { bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), name: `${safeName(file.name, "document").slice(0, -4)}-filled.pdf`, warnings };
}
