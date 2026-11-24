import { PDFDocument, PDFCheckBox, PDFDropdown, PDFTextField } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { createForm, readForm, type NewField } from "../../src/ops";
import { corpus, engines, opts } from "../helpers/env";
import { qpdfCheck } from "../helpers/qpdf";

const run = (name: string, fields: NewField[]) => createForm(corpus(name), { fields }, opts(), engines);
const inf = (r: { name: string; bytes: Uint8Array }) => ({ name: r.name, bytes: r.bytes });
const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

describe("createForm", () => {
  it("makes every kind with the right type, name, flags and rectangle; Fill's reader lists them", async () => {
    const r = await run("plain-3p", [
      { kind: "text", name: "Text 1", page: 0, ...box, required: true, size: 14 },
      { kind: "multiline", name: "Notes", page: 0, x: 0.1, y: 0.4, w: 0.5, h: 0.1 },
      { kind: "checkbox", name: "Agree", page: 1, x: 0.1, y: 0.1, w: 0.04, h: 0.04 },
      { kind: "date", name: "Date 1", page: 1, ...box },
      { kind: "dropdown", name: "Colour", page: 2, ...box, options: ["Red", "Green", "Blue"] },
      { kind: "signature", name: "Sign here", page: 2, x: 0.1, y: 0.5, w: 0.3, h: 0.06 },
    ]);
    expect(r.name).toBe("plain-3p-form.pdf");
    qpdfCheck(r.bytes);
    const doc = await PDFDocument.load(r.bytes);
    const form = doc.getForm();
    expect(form.getFields().map((f) => f.getName())).toEqual(["Text 1", "Notes", "Agree", "Date 1", "Colour", "Sign here"]);
    expect(form.getTextField("Text 1")).toBeInstanceOf(PDFTextField);
    expect(form.getTextField("Text 1").isRequired()).toBe(true);
    expect(form.getTextField("Notes").isMultiline()).toBe(true);
    expect(form.getField("Agree")).toBeInstanceOf(PDFCheckBox);
    expect(form.getField("Colour")).toBeInstanceOf(PDFDropdown);
    expect(form.getDropdown("Colour").getOptions()).toEqual(["Red", "Green", "Blue"]);
    expect(Buffer.from(r.bytes).toString("latin1")).not.toMatch(/\/NeedAppearances\s*true/);
    const info = await readForm(inf(r), {}, engines);
    const by = Object.fromEntries(info.fields.map((f) => [f.name, f]));
    expect(by["Text 1"]).toMatchObject({ type: "text", required: true, multiline: false });
    expect(by["Notes"].multiline).toBe(true);
    expect(by["Agree"].type).toBe("checkbox");
    expect(by["Colour"]).toMatchObject({ type: "dropdown", options: ["Red", "Green", "Blue"] });
    // rect: 612 x 792 page, from the top left
    const w = by["Text 1"].widgets[0];
    expect(w.page).toBe(0);
    const [W, H] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(w.rect[0]).toBeCloseTo(box.x * W, 1);
    expect(w.rect[2]).toBeCloseTo((box.x + box.w) * W, 1);
    expect(w.rect[3]).toBeCloseTo((1 - box.y) * H, 1);
    expect(w.rect[1]).toBeCloseTo((1 - box.y - box.h) * H, 1);
    expect(by["Colour"].widgets[0].page).toBe(2);
  });

  it("keeps fields that were already there", async () => {
    const r = await createForm(corpus("forms-2p"), { fields: [{ kind: "text", name: "Extra", page: 0, ...box }] }, opts(), engines);
    const before = await readForm(corpus("forms-2p"), {}, engines);
    const after = await readForm(inf(r), {}, engines);
    expect(after.fields.map((f) => f.name)).toEqual([...before.fields.map((f) => f.name), "Extra"]);
  });

  it("rotated pages: the widget keeps the displayed shape (width and height swap on a quarter turn)", async () => {
    const r = await run("rotated", [0, 1, 2, 3].map((page) => ({ kind: "text", name: `T${page}`, page, ...box }) as NewField));
    qpdfCheck(r.bytes);
    const info = await readForm(inf(r), {}, engines);
    const doc = await PDFDocument.load(r.bytes);
    expect(info.fields).toHaveLength(4);
    for (const f of info.fields) {
      const pg = doc.getPage(f.widgets[0].page);
      const rot = pg.getRotation().angle;
      const [x0, y0, x1, y1] = f.widgets[0].rect;
      const mb = pg.getMediaBox();
      const [dw, dh] = rot % 180 ? [mb.height, mb.width] : [mb.width, mb.height]; // displayed size
      expect((x1 - x0) / (y1 - y0)).toBeCloseTo(rot % 180 ? (box.h * dh) / (box.w * dw) : (box.w * dw) / (box.h * dh), 1);
      expect((x1 - x0) * (y1 - y0)).toBeCloseTo(box.w * box.h * dw * dh, -2);
    }
  });

  it("refuses bad names, duplicates, empty input, bad pages, bad choices, XFA", async () => {
    const f = (o: Partial<NewField>): NewField => ({ kind: "text", name: "A", page: 0, ...box, ...o });
    await expect(run("plain-3p", [])).rejects.toMatchObject({ code: "unsupported" });
    await expect(run("plain-3p", [f({ name: "a.b" })])).rejects.toMatchObject({ message: expect.stringContaining("can't be used") });
    await expect(run("plain-3p", [f({ name: "x".repeat(41) })])).rejects.toMatchObject({ code: "unsupported" });
    await expect(run("plain-3p", [f({}), f({})])).rejects.toMatchObject({ message: expect.stringContaining("share the name") });
    await expect(run("plain-3p", [f({ page: 9 })])).rejects.toMatchObject({ code: "unsupported" });
    await expect(run("plain-3p", [f({ kind: "dropdown", options: [] })])).rejects.toMatchObject({ message: expect.stringContaining("at least one choice") });
    await expect(run("plain-3p", [f({ kind: "dropdown", options: ["a", "a"] })])).rejects.toMatchObject({ message: expect.stringContaining("twice") });
    await expect(createForm(corpus("forms-2p"), { fields: [f({ name: (await readForm(corpus("forms-2p"), {}, engines)).fields[0].name })] }, opts(), engines)).rejects.toMatchObject({ message: expect.stringContaining("share the name") });
    await expect(createForm(corpus("risk-xfa"), { fields: [f({})] }, opts(), engines)).rejects.toMatchObject({ message: expect.stringContaining("XFA") });
  });
});
