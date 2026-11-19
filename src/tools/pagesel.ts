// "All pages / only some pages" picker shared by pdf-to-images, page-numbers and watermark.
import { parseRanges } from "../ops/ranges";
import { h } from "../ui/dom";
import { radioGroup, textField } from "../ui/fields";
import type { Ctx } from "./types";

export interface PageChoice {
  el: HTMLElement;
  /** Updates visibility and the message. Returns the chosen 0-based pages (ascending), or null while the range is not usable. `all` = every page. */
  read(pageCount: number | undefined): { all: boolean; pages: number[] } | null;
}

export function pageChoice(ctx: Ctx, id: string): PageChoice {
  const mode = radioGroup({
    name: `${id}-pages`, legend: "Pages", value: "all", testid: (v) => `pages-${v}`, onChange: () => ctx.refresh(),
    options: [["all", "All pages"], ["range", "Only some pages"]],
  });
  const range = textField({ id: `${id}-range`, label: "Which pages", placeholder: "1-3, 5, 8-", testid: "pages-input", msgTestId: "pages-msg", reserve: true, onInput: () => ctx.refresh() });
  const el = h("div", { class: "pagesel" }, mode.el, range.el);
  return {
    el,
    read(n) {
      const some = mode.value() === "range";
      range.el.hidden = !some;
      if (!n) return null;
      if (!some) { range.setError(null); return { all: true, pages: Array.from({ length: n }, (_, i) => i) }; }
      const text = range.input.value.trim();
      try {
        const pages = [...new Set(parseRanges(text, n).flat())].sort((a, b) => a - b);
        range.setError(null);
        return { all: false, pages };
      } catch (e) {
        range.setMessage(text ? (e as Error).message : "Type the pages, for example 1-3, 5.", !!text);
        return null;
      }
    },
  };
}
