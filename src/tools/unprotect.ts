import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { passwordField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => {
  const pw = passwordField({ id: "pw-current", label: "Password", autocomplete: "current-password", testid: "pw-input", msgTestId: "pw-msg", reserve: true, onInput: () => { pw.setError(null); ctx.refresh(); } });
  const note = h("p", { class: "field__hint" }, "MossPDF can only remove a password you know. It never guesses or breaks passwords. If the file opens but will not let you print, copy or edit, enter its owner password here.");
  return { pw, box: h("div", { class: "protect" }, note, pw.el), prefilled: 0 };
});

export const unprotect: ToolDef = {
  id: "unprotect", title: "Remove password", heading: "Remove a password", group: "Protect",
  blurb: "Unlock a PDF you have the password for.",
  lede: "Remove the password from a PDF you can already open.",
  accepts: "pdf",
  options(ctx) { return ui(ctx).box; },
  sync(ctx) {
    const u = ui(ctx);
    u.box.hidden = !ctx.file;
    // A password typed to open the file is offered once per file; the user can still replace it (an owner password, say).
    if (ctx.file && u.prefilled !== ctx.file.id) {
      u.prefilled = ctx.file.id;
      u.pw.input.value = ctx.file.password ?? "";
      u.pw.setError(null);
    }
  },
  warnings: (ctx) => (ctx.file?.info && !ctx.file.info.encrypted ? ["This PDF has no password, so there is nothing to remove."] : []),
  ready: (ctx) => !!ctx.file?.info?.encrypted && ui(ctx).pw.input.value !== "",
  primaryLabel: () => "Remove password",
  async run(ctx) {
    return [await ctx.call<OpResult>("unprotect", { file: ctx.input(ctx.file!), p: { password: ui(ctx).pw.input.value }, o: { producerCredit: ctx.producerCredit } })];
  },
  onError(ctx, e) {
    if (e.code !== "wrong-password" && e.code !== "encrypted") return false;
    const { pw } = ui(ctx);
    // A file that opened without a password but restricts printing, copying or editing is only unlocked by its owner password.
    const opensFree = !ctx.file?.password && !/owner password/.test(e.message);
    pw.setError(opensFree ? `${e.message} If this file opens without a password but will not let you print, copy or edit, only its owner password removes that.` : e.message);
    queueMicrotask(() => pw.input.focus()); // after the job ends and the panel is enabled again
    return true;
  },
};
