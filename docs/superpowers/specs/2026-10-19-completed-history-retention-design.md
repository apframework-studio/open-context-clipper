# Completed history retention

Date: 2026-10-19

## Product behavior

- 收件箱 remains the durable working queue. Export initiation moves selected records to 已完成 without another click.
- 已完成 is recent local export history. Re-export preserves `completedAt` and updates `lastExportedAt`; the newest export is the retention clock.
- A separate 设置 entry offers 永久（default）, 30 天, and 90 天. The setting applies only to completed records. The user configures it once; there is no per-record completion action.
- When a timed policy is enabled or changed, all pre-existing completed records receive a full grace period beginning at that settings change. This avoids immediate deletion when changing the preference.
- Expired completed records are permanently deleted on the next queue open, not by background polling. The inbox is never eligible. An error loading settings or cleaning history leaves records intact and shows a nonblocking notice.
- The UI explains that the extension observes download initiation, not successful disk persistence. Automatic deletion is therefore off by default. Exported files remain outside extension storage; there is currently no import feature.

## Technical boundary

- Persist `{ days: null | 30 | 90, enabledAt?: string }` in `chrome.storage.local`, using the existing `storage` permission. The background validates saved values and update requests.
- `CaptureRecord` gains optional `lastExportedAt`. Existing records use `completedAt` as fallback.
- The repository deletes only completed records whose `max(lastExportedAt || completedAt, enabledAt)` precedes the retention cutoff. Cleanup and preference updates are separate operations; updating the setting cannot delete records immediately.
- The background applies cleanup during `LIST_CAPTURES`. A cleanup failure returns the records with a warning. No capture timing, page access, data transmission, or Chrome permissions change.

## Verification

- Test expiration boundaries, grace period, inbox protection, re-export clock, setting validation/persistence, cleanup failure, and settings UI.
- Run `npm test`, `npm run typecheck`, and `npm run build`; update README's retention and privacy explanation. The user will manually verify the rebuilt extension in Chrome.
