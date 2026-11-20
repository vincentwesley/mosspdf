// Types for the M3 ops: protect, unprotect, safetyScan, cleanCopy, repair. Kept apart from types.ts so parallel milestones merge cleanly.
import type { OpResult } from "./types";

export interface Permissions {
  print: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
}
export interface ProtectOptions {
  userPassword: string;
  /** Empty or missing: the user password is used for both (so either one opens and unlocks the file). */
  ownerPassword?: string;
  /** Anything omitted stays allowed. */
  permissions?: Partial<Permissions>;
}
export interface UnprotectOptions {
  password: string;
}

export type SafetyKind =
  | "javascript"
  | "open-action"
  | "additional-actions"
  | "launch"
  | "embedded-file"
  | "file-attachment"
  | "submit-form"
  | "import-data"
  | "uri"
  | "go-to-remote"
  | "go-to-embedded"
  | "rich-media"
  | "media-action"
  | "hide-action"
  | "xfa"
  | "object-streams"
  | "jbig2";
export type Severity = "high" | "medium" | "info";
export interface SafetyItem {
  kind: SafetyKind;
  severity: Severity;
  /** 1-based page number, or "document" for anything not tied to one page. */
  where: number | "document";
  /** The target, filename or trigger, when there is one (for example the URL of a link). */
  detail?: string;
  /** Plain language: what this can do. */
  explanation: string;
}
export interface SafetyReport {
  items: SafetyItem[];
  /** True when something of high or medium severity was found ("info" items alone are not risky). */
  risky: boolean;
  pageCount: number;
  encrypted: boolean;
  /** The file was damaged and had to be repaired before it could be scanned. */
  repaired: boolean;
}

export interface CleanOptions {
  /** Keep plain web links (/URI). Everything else the scan flags is removed. */
  keepLinks: boolean;
  /** Also remove annotation authors and dates (/T, /M, /CreationDate) and every /Metadata (XMP) packet, whatever it hangs from. */
  scrubPersonal?: boolean;
}
export interface CleanResult extends OpResult {
  removed: SafetyItem[];
  /** What a re-scan of the cleaned copy still finds (only web links when they were kept, plus info items). */
  remaining: SafetyItem[];
}

export interface RepairResult extends OpResult {
  repaired: boolean;
  /** What was done, in plain language. */
  actions: string[];
  /** Pages found in the damaged original, when that can be known (null otherwise). */
  pagesBefore: number | null;
  pagesAfter: number;
  /** False when pages were lost: never present the file as fully recovered. */
  complete: boolean;
}
