// The contract between a tool module (src/tools/<id>.ts) and the shared workspace (src/ui/workspace.ts).
import type { LoadedFile } from "../core/store";
import type { CallOptions } from "../core/rpc";
import type { InFile, OpResult, PdfError } from "../ops/types";
import type { PageItem } from "../ui/pagegrid";

export const GROUPS = ["Organize", "Convert", "Edit", "Protect", "Fill and sign", "OCR", "Privacy", "Compare"] as const;
export type GroupName = (typeof GROUPS)[number];

/** What a tool takes in. pdf: one PDF (a new one replaces it); pdfs: any number, reorderable; images: JPG/PNG/WebP, reorderable; pdf-pair: exactly two PDFs, labelled Original / Changed. */
export type Accepts = "pdf" | "pdfs" | "images" | "pdf-pair";

export interface GridOpts {
  /** Cards get a select toggle (extract). */
  selectable?: boolean;
  /** Cards name their source file (merge). */
  showFile?: boolean;
  /** Start with the grid shown. Default true; merge starts closed and opens it with `ctx.setPagesOpen`. */
  open?: boolean;
}

/** Per-view state and helpers handed to every hook. One Ctx lives as long as one tool view. */
export interface Ctx {
  tool: ToolDef;
  /** Ready input files of this tool's kind, in list order. For accepts "pdf" at most the newest one. */
  readonly files: LoadedFile[];
  /** files[0]. */
  readonly file: LoadedFile | undefined;
  /** Page grid state (grid tools): order, rotation, selection. Empty for other tools. */
  items: PageItem[];
  /** The grid was edited by the user since the files last changed. */
  dirty: boolean;
  pagesOpen: boolean;
  setPagesOpen(open: boolean): void;
  /** Redraw the grid after changing `items` (extract selecting from text). */
  syncGrid(): void;
  /** Output settings. */
  readonly producerCredit: boolean;
  /** Re-evaluate the action bar and `sync` after an option changed. Call it from your inputs' `input` events. */
  refresh(): void;
  /** Per-view tool state: `init` runs once, later calls return the same object. */
  local<T>(init: () => T): T;
  /** Progress and cancel options for the running job (valid inside `run`). */
  readonly o: CallOptions;
  /** Calls an op in the ops worker with the job's abort signal and progress wired in. */
  call<T>(op: string, payload: unknown): Promise<T>;
  /** A loaded PDF in the form the ops expect. */
  input(f: LoadedFile): InFile;
}

export interface ToolDef {
  /** Route (`#/<id>`), test ids and file names use it. Final; never rename. */
  id: string;
  /** Tile text and navigation name. */
  title: string;
  /** Page heading when it differs from the title ("Merge PDFs" for "Merge"). */
  heading?: string;
  /** One line for the home tile. */
  blurb: string;
  group: GroupName;
  /** One sentence under the heading. */
  lede: string;
  accepts: Accepts;
  /** Show the page grid (reorder, rotate, delete, optionally select). */
  grid?: boolean | GridOpts;
  /** Dropzone heading when the default for `accepts` does not fit. */
  dropTitle?: string;
  /** Builds the options panel once per view. Call `ctx.refresh()` when a value changes. */
  options?(ctx: Ctx): HTMLElement;
  /** Runs on every refresh: show/hide option parts, validate and set field errors. */
  sync?(ctx: Ctx): void;
  /** The grid items were rebuilt (files changed) or edited by the user. */
  onItems?(ctx: Ctx): void;
  /** Notes shown above the options for the current files, e.g. `pdfLossWarnings`. */
  warnings?(ctx: Ctx): string[];
  /** Whether the action may run. Default: merge-style minimum for `accepts` (1 file, or exactly 2 for pdf-pair). */
  ready?(ctx: Ctx): boolean;
  /** Label of the main button. Default: the title. */
  primaryLabel?(ctx: Ctx): string;
  /** Does the work and returns the files to download. Throw `PdfError` for plain-language failures. Absent = planned: home shows "Coming soon", the route shows the intake only. */
  run?(ctx: Ctx): Promise<OpResult[]>;
  /** `run` threw a PdfError: return true when the tool shows it inline (a field error), so the status line stays quiet. */
  onError?(ctx: Ctx, e: PdfError): boolean;
}
