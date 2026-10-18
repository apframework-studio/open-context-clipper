# Queue Management Redesign Implementation Plan

Implementation record: the steps below were completed in the current workspace.

**Goal:** Deliver a full-window local queue with automatic completion after export and bulk ZIP export.

**Architecture:** Keep article and export state in the current IndexedDB repository, exposing a batch completion message through the service worker. Build ZIP files in the queue page, then initiate a download and persist completion. Render a compact list plus detail panel over the existing message client.

**Tech Stack:** TypeScript, Chrome MV3, IndexedDB, Vitest, esbuild, ZIP library with browser support.

**Spec:** `docs/superpowers/specs/2026-10-18-queue-management-design.md`

## Global Constraints

- No new Chrome permissions or background network behavior.
- Existing IndexedDB records must remain readable without a database version change.
- Follow test-first implementation for behavior changes, then run `npm test`, `npm run typecheck`, and `npm run build`.
- Preserve existing Markdown and JSON exports while adding ZIP.

---

### Task 1: Persist completion independently of delivery status

**Files:** `src/shared/models.ts`, `src/shared/messages.ts`, `src/storage/capture-repository.ts`, `src/background/service-worker.ts`, `tests/storage/capture-repository.test.ts`, `tests/background/service-worker.test.ts`.

**Interfaces:** Add `completedAt?: string` to `CaptureRecord`; add `MARK_CAPTURES_COMPLETE` with `ids: string[]` and return updated `CAPTURES`; add `CaptureRepository.markCompleted(ids, completedAt)` and make the badge count exclude completed records.

- [x] Add repository tests showing an old record starts in the inbox, a batch gains the same completion timestamp, repeated completion preserves the first timestamp, and a changed article returns to the inbox. Run `npm test -- tests/storage/capture-repository.test.ts` and confirm expected failures.
- [x] Implement the smallest repository and model changes; rerun the focused test to green.
- [x] Add background tests for valid/invalid completion requests, returned records, and badge refresh. Run `npm test -- tests/background/service-worker.test.ts` and confirm expected failures.
- [x] Implement message validation and handler; rerun the focused tests to green.

### Task 2: Create a portable ZIP

**Files:** `src/queue/export.ts`, `tests/queue/export.test.ts`, `package.json`, `package-lock.json`.

**Interfaces:** Add `recordsToZip(records): Uint8Array`, with `articles/<safe-title>-<id>.md` entries plus `captures.json`; add a binary download helper while preserving `downloadText`.

- [x] Add a test that opens the generated ZIP and checks both Markdown entries, JSON metadata, and safe unique filenames. Run `npm test -- tests/queue/export.test.ts` and confirm expected failure.
- [x] Add the ZIP dependency, implement the helper, and rerun the focused test to green.

### Task 3: Make export move records to history

**Files:** `src/queue/main.ts`, `tests/queue/main.test.ts`.

**Interfaces:** Single Markdown, selected JSON, selected ZIP, and all-visible ZIP each initiate their download and then send `MARK_CAPTURES_COMPLETE`; completion failures keep the local inbox view and show an error.

- [x] Add queue controller tests for each export path, duplicate inclusion, view changes, and download/persistence failures. Run `npm test -- tests/queue/main.test.ts` and confirm expected failures.
- [x] Implement the new controller actions and clear selection updates; rerun focused tests to green.

### Task 4: Fill the viewport and simplify queue controls

**Files:** `src/queue/main.ts`, `src/queue/styles.css`, `tests/queue/main.test.ts`, `README.md`.

**Interfaces:** Render 收件箱 and 已完成 navigation, list toolbar, compact rows, and one detail panel with note and destructive actions. Keep source-derived text in `textContent`.

- [x] Add focused DOM assertions for the two views, selection toolbar, detail note editor, and absence of the clipped row menu. Run the queue tests and confirm expected failures.
- [x] Implement markup and CSS for desktop and narrow viewports; rerun focused tests to green.
- [x] Update README usage and privacy/export wording, including the browser download completion limitation.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`; inspect the built page in real Chrome and report exact coverage.
