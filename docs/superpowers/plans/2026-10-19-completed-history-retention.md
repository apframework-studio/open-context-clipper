# Completed History Retention Implementation Plan

**Goal:** Add one-time local retention settings and safe cleanup for completed history.

**Architecture:** Store the preference in `chrome.storage.local`, retain article data in IndexedDB, and perform cleanup only while listing the queue. A re-export updates `lastExportedAt` while preserving the first completion timestamp.

**Tech Stack:** TypeScript, Chrome MV3, IndexedDB, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-completed-history-retention-design.md`

## Constraints

- Keep the existing manifest permissions and user-triggered capture behavior.
- Never delete inbox records; permanent cleanup is opt-in through a timed setting.
- Follow test-first cycles and run all repository checks before completion.

### Task 1: Model and repository retention behavior

**Files:** `src/shared/models.ts`, `src/storage/capture-repository.ts`, `tests/storage/capture-repository.test.ts`.

- [x] Add failing tests: repeated `markCompleted` preserves `completedAt` and refreshes `lastExportedAt`; `deleteExpiredCompleted(cutoff, enabledAt)` deletes only completed records whose effective activity date is before the cutoff, including the exact boundary and grace-period cases.
- [x] Run `npm test -- --run tests/storage/capture-repository.test.ts` and verify expected failures.
- [x] Add optional `lastExportedAt` and repository methods, then rerun the focused test to green.

### Task 2: Background settings and cleanup

**Files:** `src/shared/messages.ts`, `src/background/service-worker.ts`, `tests/helpers/chrome.ts`, `tests/background/service-worker.test.ts`.

- [x] Add failing tests for `GET_HISTORY_SETTINGS`, `UPDATE_HISTORY_SETTINGS`, invalid values, timed cleanup on `LIST_CAPTURES`, default forever, and nonblocking cleanup failure.
- [x] Run `npm test -- --run tests/background/service-worker.test.ts` and verify expected failures.
- [x] Implement typed local settings through the Chrome port, request validation, policy grace timestamps, and list-time cleanup; rerun focused tests to green.

### Task 3: Settings page, re-export, and documentation

**Files:** `src/queue/main.ts`, `src/queue/styles.css`, `tests/queue/main.test.ts`, `README.md`, `docs/HANDOFF.md`.

- [x] Add failing UI tests for a separate 设置 entry, default 永久 setting, saving 30/90/永久, and a re-export refreshing activity without moving history out of 已完成.
- [x] Run `npm test -- --run tests/queue/main.test.ts` and verify expected failures.
- [x] Implement settings UI and re-export messages, then rerun focused tests to green.
- [x] Document the lazy cleanup timing and download limitation. Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
