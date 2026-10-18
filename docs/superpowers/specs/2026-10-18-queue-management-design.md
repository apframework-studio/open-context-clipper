# Queue management redesign

Date: 2026-10-18

## Goal

Make the local queue useful across the full browser window, with a compact article list, a focused detail panel, and clear single and bulk export actions. Keep the existing visual palette.

## Workflow

- The primary views are **收件箱** and **已完成**. Existing records without a completion timestamp appear in 收件箱. An export action moves its records to 已完成 automatically; no separate completion click is required.
- Completion is a local queue concept, separate from `delivery.status`, which is reserved for the future Companion boundary. Store an optional `completedAt` timestamp on each record without changing the IndexedDB schema version. A newly captured revision of the same URL returns to 收件箱.
- A single article exports as Markdown. The prominent bulk action exports the current inbox as one ZIP containing one Markdown file per record and `captures.json`. Checkbox selection allows a subset ZIP or JSON export. Duplicate candidates may be exported directly when selected; the existing duplicate marker remains visible.
- The local page can confirm that it initiated a browser download, but cannot confirm the file was saved without adding the `downloads` permission. Mark records complete after the download has been initiated. If archive persistence then fails, retain the records in 收件箱 and show an explicit error.
- Re-exporting a completed record keeps it in 已完成 and preserves its original completion timestamp.

## Layout

- Fill the browser viewport. Use a fixed-width navigation rail and a fluid workspace; remove the 1160px page cap, outer card framing, oversized summary cards, and focus banner.
- Put search/filter and bulk actions directly above a compact, scrollable article list. The main ZIP action exports all currently visible inbox records in one click; selection controls enable subset export.
- Clicking a row shows its metadata, excerpt, note, and actions in a detail panel. The note editor appears only in this panel when requested. On narrower windows, the detail panel becomes a full-width section below the list.
- Show open-source and Markdown export actions directly. Put delete behind its existing confirmation in the detail panel; remove the clipped per-row more-actions dropdown.

## Constraints and verification

- Keep capture timing, Chrome permissions, local-only storage, and transmission behavior unchanged.
- Test export contents and safe filenames, completion persistence and badge count, failure handling, and UI selection/view transitions. Run `npm test`, `npm run typecheck`, and `npm run build`.
- Inspect the built queue in a real Chrome installation before claiming browser interaction verification. Update README for the new export and completion behavior and record any UI checks that cannot be completed.
