// The saved accessibility report. Lives outside src/ops so the main thread can use it without pulling in pdf-lib.
import type { A11yReport, A11yStatus } from "../ops/a11y";

const MARK: Record<A11yStatus, string> = { pass: "PASS", warn: "CHECK", fail: "FAIL" };
/** The plain-text report people can save. */
export function a11yReportText(name: string, r: A11yReport): string {
  const n = (s: A11yStatus) => r.checks.filter((c) => c.status === s).length;
  return [
    `Accessibility check: ${name}`,
    `${r.pageCount} pages. ${n("pass")} passed, ${n("warn")} to look at, ${n("fail")} failed.`,
    "",
    ...r.checks.flatMap((c) => [`[${MARK[c.status]}] ${c.label}`, `  ${c.detail}`, ...(c.fix ? [`  How to fix: ${c.fix}`] : []), ""]),
    "This is a basic check of the signals screen readers rely on. It is not a PDF/UA validation or a certificate.",
    "",
  ].join("\n");
}
