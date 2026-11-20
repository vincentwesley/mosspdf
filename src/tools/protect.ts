import type { OpResult } from "../ops/types";
import { h } from "../ui/dom";
import { checkField, passwordField } from "../ui/fields";
import type { Ctx, ToolDef } from "./types";

const ui = (ctx: Ctx) => ctx.local(() => {
  const again = () => ctx.refresh();
  const perm = (id: string, label: string) => checkField({ id: `perm-${id}`, label, checked: true, testid: `perm-${id}`, onChange: again });
  const perms = { print: perm("print", "Allow printing"), copy: perm("copy", "Allow copying text and images"), edit: perm("edit", "Allow editing pages"), comment: perm("comment", "Allow adding comments"), fill: perm("fill", "Allow filling in forms") };
  const more = h("details", { class: "more", attrs: { "data-testid": "more-options" } }, h("summary", { text: "More options" }));
  const f = {
    pw: passwordField({ id: "pw-new", label: "Password to open the file", autocomplete: "new-password", testid: "pw-input", msgTestId: "pw-msg", onInput: again }),
    confirm: passwordField({ id: "pw-confirm", label: "Type it again", autocomplete: "new-password", testid: "pw-confirm", msgTestId: "pw-confirm-msg", reserve: true, onInput: again }),
    owner: passwordField({ id: "pw-owner", label: "Owner password (optional)", hint: "A second password, needed to change these settings later. Leave it empty to use the same password for both.", autocomplete: "new-password", testid: "owner-input", msgTestId: "owner-msg", onInput: again }),
  };
  const strength = h("p", { class: "field__hint", attrs: { "data-testid": "pw-strength" } });
  more.append(
    f.owner.el,
    h("fieldset", { class: "perms" }, h("legend", { text: "What people with the password may do" }), ...Object.values(perms).map((p) => p.el)),
    h("p", { class: "field__hint", text: "Most PDF readers honour these limits, but not all do. They stop casual use, they are not a lock. Only the password keeps people out." }));
  const box = h("div", { class: "protect" }, f.pw.el, strength, f.confirm.el, more);
  return { f, perms, strength, more, box };
});

/** Length-based only: no word list, no network. */
const strengthOf = (p: string) => (p.length < 8 ? "Short. Use at least 8 characters." : p.length < 12 ? "Fair. 12 or more characters is better." : "Long enough.");
const restricted = (ctx: Ctx) => Object.values(ui(ctx).perms).some((p) => !p.input.checked);

function problems(ctx: Ctx) {
  const { f } = ui(ctx);
  const pw = f.pw.input.value;
  const owner = f.owner.input.value;
  return {
    mismatch: f.confirm.input.value !== "" && f.confirm.input.value !== pw,
    needOwner: restricted(ctx) && !owner,
    sameOwner: restricted(ctx) && !!owner && owner === pw,
  };
}

export const protect: ToolDef = {
  id: "protect", title: "Add password", heading: "Add a password", group: "Protect",
  blurb: "Lock a PDF with a password.",
  lede: "Lock a PDF so it needs a password to open.",
  accepts: "pdf", batch: true,
  options(ctx) { return ui(ctx).box; },
  sync(ctx) {
    const u = ui(ctx);
    u.box.hidden = !ctx.file;
    const p = problems(ctx);
    u.strength.textContent = u.f.pw.input.value ? `Strength: ${strengthOf(u.f.pw.input.value)}` : "Choose a password you will remember. Pagehold cannot recover it for you.";
    u.f.confirm.setError(p.mismatch ? "The two passwords do not match." : null);
    u.f.owner.setError(p.needOwner ? "Limits only hold with a separate owner password. Set one, or allow everything." : p.sameOwner ? "The owner password must differ from the opening password, or the limits do not apply." : null);
    if ((p.needOwner || p.sameOwner) && !u.more.open) u.more.open = true;
  },
  warnings: (ctx) => (ctx.file?.info?.encrypted ? ["This file already has a password. The new one replaces it."] : []),
  ready(ctx) {
    const u = ui(ctx);
    const p = problems(ctx);
    return !!ctx.file && u.f.pw.input.value !== "" && u.f.confirm.input.value === u.f.pw.input.value && !p.needOwner && !p.sameOwner;
  },
  primaryLabel: () => "Add password",
  async run(ctx) {
    const { f, perms } = ui(ctx);
    const r = await ctx.call<OpResult>("protect", {
      file: ctx.input(ctx.file!),
      p: {
        userPassword: f.pw.input.value,
        ownerPassword: f.owner.input.value,
        permissions: { print: perms.print.input.checked, copy: perms.copy.input.checked, modify: perms.edit.input.checked, annotate: perms.comment.input.checked, fillForms: perms.fill.input.checked },
      },
      o: { producerCredit: ctx.producerCredit },
    });
    return [r];
  },
};
