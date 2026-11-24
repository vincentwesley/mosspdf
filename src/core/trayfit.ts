// Which loaded files a tool will not use (pure; shown dimmed in the tray).
export interface Fit { kind: "pdf" | "image"; /** Only the newest PDF is used. */ single?: boolean }

/** Why a file is not used by a tool, or "" when it is. Pure. */
export function unfitReason(f: { id: number; kind: "pdf" | "image" }, all: { id: number; kind: "pdf" | "image" }[], fit?: Fit): string {
  if (!fit) return "";
  if (f.kind !== fit.kind) return fit.kind === "image" ? "This tool takes pictures, not PDFs." : "This tool takes PDFs, not pictures.";
  if (fit.single && all.filter((x) => x.kind === fit.kind).at(-1)?.id !== f.id) return "This tool uses one PDF: the newest.";
  return "";
}

