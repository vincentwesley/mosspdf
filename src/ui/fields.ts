// Option fields for tool panels: a label, the control, an optional hint and an error line wired with aria-describedby.
// Every control is labelled; error text goes in `msg` (role=status) and flips aria-invalid on the control.
import { h } from "./dom";

interface Base {
  /** Unique within the page; also the control's id. */
  id: string;
  label: string;
  hint?: string;
  /** data-testid of the control, and of its message line. */
  testid?: string;
  msgTestId?: string;
  /** Keep room for the message so the layout does not jump when it appears. */
  reserve?: boolean;
  onInput?: () => void;
}
export interface Field<E extends HTMLElement = HTMLInputElement> {
  /** `div.field` to place in the options panel; toggle `hidden` on it to hide the whole field. */
  el: HTMLDivElement;
  input: E;
  /** Message under the control (status text); `invalid` also marks the control aria-invalid. */
  setMessage(text: string, invalid?: boolean): void;
  /** Shorthand: an error message, or null/empty to clear. */
  setError(text?: string | null): void;
}

function wrap<E extends HTMLElement>(o: Base, input: E, label = true): Field<E> {
  const msg = h("p", { class: `field__msg${o.reserve ? " field__msg--reserve" : ""}`, id: `${o.id}-msg`, attrs: { role: "status", "data-testid": o.msgTestId } });
  const hint = o.hint ? h("p", { class: "field__hint", id: `${o.id}-hint`, text: o.hint }) : null;
  input.setAttribute("aria-describedby", [hint && `${o.id}-hint`, `${o.id}-msg`].filter(Boolean).join(" "));
  if (o.testid) input.setAttribute("data-testid", o.testid);
  if (o.onInput) input.addEventListener("input", o.onInput);
  const el = h("div", { class: "field" }, label && h("label", { text: o.label, attrs: { for: o.id } }), hint, input, msg);
  const setMessage = (text: string, invalid = false) => {
    msg.textContent = text;
    if (invalid) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  return { el, input, setMessage, setError: (text) => setMessage(text ?? "", !!text) };
}

export function textField(o: Base & { value?: string; placeholder?: string; inputmode?: string }): Field {
  const input = h("input", { class: "hs-input", id: o.id, type: "text", attrs: { inputmode: o.inputmode ?? "text", autocomplete: "off", spellcheck: "false", placeholder: o.placeholder, value: o.value ?? "" } });
  return wrap(o, input);
}

export function numberField(o: Base & { value: number; min?: number; max?: number; step?: number; decimal?: boolean }): Field {
  const input = h("input", { class: "hs-input", id: o.id, type: "number", attrs: { min: o.min, max: o.max, step: o.step, value: o.value, inputmode: o.decimal ? "decimal" : "numeric" } });
  return wrap(o, input);
}

export function selectField(o: Base & { options: [value: string, label: string][]; value?: string }): Field<HTMLSelectElement> {
  const input = h("select", { class: "hs-select", id: o.id }, ...o.options.map(([v, l]) => h("option", { text: l, attrs: { value: v } })));
  if (o.value !== undefined) input.value = o.value;
  return wrap(o, input);
}

export function colourField(o: Base & { value: string }): Field {
  const input = h("input", { class: "hs-input hs-color", id: o.id, type: "color", attrs: { value: o.value } });
  return wrap(o, input);
}

/** A password input with a Show/Hide button. Use autocomplete "new-password" when choosing one, "current-password" when entering one. */
export function passwordField(o: Base & { autocomplete: "new-password" | "current-password" }): Field {
  const input = h("input", { class: "hs-input", id: o.id, type: "password", attrs: { autocomplete: o.autocomplete, spellcheck: "false", autocapitalize: "off", autocorrect: "off", maxlength: 127 } });
  const f = wrap(o, input);
  const toggle = h("button", { class: "hs-btn hs-btn--secondary", type: "button", text: "Show", attrs: { "aria-controls": o.id, "data-testid": o.testid && `${o.testid}-toggle` } });
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
  });
  f.el.insertBefore(h("div", { class: "pwfield" }, input, toggle), f.el.lastElementChild);
  return f;
}

export interface CheckField {
  el: HTMLDivElement;
  input: HTMLInputElement;
}
export function checkField(o: { id: string; label: string; checked?: boolean; testid?: string; onChange?: () => void }): CheckField {
  const input = h("input", { class: "hs-check", id: o.id, type: "checkbox", attrs: { "data-testid": o.testid } });
  input.checked = !!o.checked;
  if (o.onChange) input.addEventListener("change", o.onChange);
  return { el: h("div", { class: "field field--check" }, input, h("label", { text: o.label, attrs: { for: o.id } })), input };
}

export interface RadioGroup {
  /** `fieldset` with a `legend`. */
  el: HTMLFieldSetElement;
  value(): string;
  set(v: string): void;
}
/** Native radios (arrow keys work), styled with `hs-check hs-check--radio`. `testid(value)` names each radio's data-testid. */
export function radioGroup(o: { name: string; legend: string; options: [value: string, label: string][]; value: string; testid?: (v: string) => string; onChange?: (v: string) => void }): RadioGroup {
  const el = h("fieldset", { class: "radios" }, h("legend", { text: o.legend }));
  const radios = o.options.map(([v, label]) => {
    const r = h("input", { type: "radio", id: `${o.name}-${v}`, class: "hs-check hs-check--radio", attrs: { name: o.name, value: v, "data-testid": o.testid?.(v) } });
    r.checked = v === o.value;
    r.addEventListener("change", () => { if (r.checked) o.onChange?.(v); });
    el.append(h("div", { class: "radios__opt" }, r, h("label", { attrs: { for: r.id }, text: label })));
    return r;
  });
  return { el, value: () => radios.find((r) => r.checked)?.value ?? o.value, set: (v) => radios.forEach((r) => { r.checked = r.value === v; }) };
}
