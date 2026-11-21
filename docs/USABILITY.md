# Usability walkthroughs (M9)

Method: built `dist`, served with wrangler dev, driven headless in Chromium by a throwaway script (`qa-output/walk/walk.mjs`, gitignored). Screenshots in `qa-output/walk/`. Times are machine time, not human time; the step count is user actions.

## 1. Phone user (Pixel 7, 375px): merge two PDFs, then sign

Steps (8): open Merge, Choose files (2), Merge 2 files, "Sign" in Use in another tool, type name, Place on page, Save signed copy, Download.
Machine time about 19 s. Output `merged-signed.pdf`, 6 pages, no console errors.

Worked: the merged file carries straight into Sign (no re-upload); typed signature renders in a real handwriting font; disclaimer says it is not a certified signature; sticky action bar keeps the main button in reach.

Friction (ranked):
1. Dead end: after Merge the next-step list had no Sign, so the user had to go home and find it, then re-add the file. FIXED (merge now offers Sign first).
2. Move-up / move-down / remove buttons on each file were 20px wide (below the 48px target). FIXED.
3. Footer credit links ("@portus_workstation", "@wason25_pz") were 20px high. FIXED.
4. "Save signed copy" is disabled with no stated reason until a signature is placed; the how-to is a step above. LEFT: the numbered steps on the page already explain it; adding a reason line means changing tool copy in several places.
5. Output settings checkbox is 24px visual (44px hit area via `.hs-check::after`, house kit). LEFT: house kit design.
6. Sign page is long on a phone (6 pages stacked); the placed signature is far from the Place button. LEFT: needs a layout change (scroll-to-placed), not a small fix.

## 2. Office worker (1280px): redact NRIC and phone, then compress

Steps (7): open Redact, add file, untick Email and Street addresses, Redact 2 items, Use in another tool > Compress, Compress, Download. Machine time about 8 s.

Worked: detections appear automatically and are masked in the list (`S****567D`); the primary button states the count ("Redact 2 items"); the result card lists compress as a next step and the redacted file moves across with its name.

Friction (ranked):
1. Redact's result is the cleanest hand-off to Compress, but the user has to know to look for it under "Use in another tool". LEFT: present and discoverable in the result card.
2. Postal codes are a separate tick box from street addresses; a user removing the address may not realise the postal code is still ticked. FIXED: unticking Street addresses also unticks Postal codes (re-tick if wanted).
3. Sticky action bar overlaps the review panel in full-page screenshots only (artifact of capture, not a user issue).

## 3. Power user, keyboard only (1280px): Ctrl+K, Clean copy to share, batch page numbers

Steps: Ctrl+K, type "safe", Enter (focus lands on the page heading), Tab to Choose files, add file, Run, Ctrl+K "page numbers", Enter, add two files, run batch. Machine time about 16 s.

Worked: palette opens with focus in the input, fuzzy matches, Enter routes and focuses the heading; result heading takes focus after a run; batch button says "Add page numbers (3 files)" and the zip is offered.

Friction (ranked):
1. The earlier workflow's file stayed loaded when moving to Page numbers, so the batch ran on 3 files (one unintended). The "Clear all" with undo exists, but nothing flags that a file is carried over. LEFT: deliberate carry-over behaviour (store is global); flag as a product decision.
2. Pressing Enter on "Choose files" in the headless run did not raise a file chooser event (not confirmed as a real bug; headless chooser events on keyboard activation are unreliable). LEFT: verify by hand in a real browser.
3. Typing "page numbers" in the palette shows its group as "Edit"; harmless.

## Fixes

| # | Fix | Status | Where |
|---|-----|--------|-------|
| P1-1 | Merge offers Sign as the first next step | fixed | `src/tools/merge.ts` (`next`) |
| P1-2 | File row arrow/remove buttons min 48px wide | fixed | `src/style.css` (`.file__acts .pg__btn`) |
| P1-3 | Footer credit links min 48px tall | fixed | `src/style.css` (`footer > p a`) |
| P1-4 | Disabled Save reason | fixed | `src/tools/sign.ts` (`whyDisabled`), `src/ui/workspace.ts` |
| P1-5 | 24px checkbox visual | left (house kit) | |
| P1-6 | Long sign page on phone | fixed | `src/tools/sign.ts` (`add` scrolls the placed box into view and focuses it) |
| P3-1 | Carried-over files unflagged | fixed | `src/ui/workspace.ts` (`carryBox`; not shown after "Use in another tool") |
| P3-2 | Keyboard Enter on Choose files | not a bug | Choose files is a real button calling input.click(); headless artifact, not a bug |
