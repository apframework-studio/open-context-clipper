> 历史归档：本文写于插件仍位于 Open Context Forge 仓库时；其中的旧路径和名称不是当前仓库约束。请先读 `AGENTS.md` 与 `docs/HANDOFF.md`。

# Chrome Capture Extension Design

**Status:** approved for implementation planning
**Date:** 2026-09-18
**Scope:** Open Context Forge Capture Plane, v0.1 local Chrome extension

## 1. Outcome

Add a locally installable Chrome extension that lets a writer capture the rendered article currently open in Chrome, review a compact preview, and save an offline capture record. The extension is the product's Capture Plane; it is not a Codex skill and it does not invoke knowledge compilation.

The product flow is:

```text
logged-in or public web page
→ extract rendered article
→ concise popup preview
→ user confirms
→ local offline queue
→ later batch export or local Companion sync
```

Medium is a first-class validation target because its articles often require an existing browser login. The extension reads only the already rendered DOM of the active tab. It does not access cookies, credentials, private APIs, or content that the current page does not render.

## 2. Scope and non-goals

### v0.1 includes

- Manifest V3 Chrome extension, loaded locally from a generated `dist/` directory.
- One-page popup that extracts and previews the active page.
- Generic article extraction with a small Medium-specific metadata and article fallback.
- Conversion of cleaned rendered HTML to Markdown.
- Preservation of absolute image URLs in Markdown; image binaries and HTML snapshots are not stored.
- Optional short personal note at confirmation time.
- IndexedDB-backed offline capture queue that survives browser restarts.
- Capture preview, local queue, source opening, deletion, duplicate handling, single-document Markdown export, and batch JSON export.
- A typed, unimplemented boundary for a future local Companion batch-sync API.
- Automated tests, build validation, and local installation documentation.

### v0.1 does not include

- A local Companion process, management web app, inbox-to-raw writer, or vault updates.
- AI summarization, auto-tagging, classification, source analysis cards, compilation plans, wiki-note generation, or git commits.
- Cloud sync, Chrome Web Store distribution, telemetry, analytics, remote-code loading, or automatic background synchronization.
- Downloading, caching, transforming, or hosting images.

The future system boundary is intentional:

```text
Chrome extension: capture, confirm, queue, export/sync request
Companion system: inbox management, approval, raw write, later knowledge operations
Skills: decision and compilation behavior used by the Companion, not user interaction
```

## 3. Repository placement and implementation approach

The extension lives outside `vault/`, `skills/`, `workflows/`, and `workspace/`:

```text
apps/chrome-extension/
  manifest.json
  package.json
  tsconfig.json
  scripts/build.mjs
  src/
    background/
    content/
    extraction/
    popup/
    queue/
    storage/
    sync/
    shared/
  tests/
    fixtures/
  public/icons/
  README.md
  dist/                    # generated and ignored
```

Three approaches were considered:

1. Plain JavaScript with no build step: simple to load, but dependency management, modularity, tests, and maintainability become awkward.
2. A browser-extension framework such as WXT or Plasmo: productive for broad UI and multi-browser requirements, but unnecessary framework surface for this local Chrome-only MVP.
3. TypeScript, Manifest V3, a small esbuild build script, and native HTML/CSS popup pages: keeps the extension portable, testable, and low in framework coupling.

Use approach 3. The build output is what the user selects through Chrome's **Load unpacked** control.

## 4. Permissions and trust boundary

The v0.1 manifest requests only:

```json
{
  "permissions": ["activeTab", "scripting", "storage"]
}
```

- `activeTab` and `scripting` permit capture only after the user opens the extension on the current page; the extension does not request blanket access to every site.
- `storage` supports settings and the offline queue.
- No cookie, history, downloads, notifications, host, or broad site-access permissions are required in v0.1.

The popup renders a text-only preview. It never trusts or directly inserts source-page HTML. Markdown is saved as data; any future Companion renderer must sanitize it again before display.

The extension never sends article text off-device automatically. Export and future syncing are explicit user actions. A later Companion API must bind only to `127.0.0.1` and require a pairing token; that server is outside this scope.

## 5. User experience

### 5.1 Capture interaction

Opening the extension popup starts recognition of the active tab. The popup contains one focused page:

```text
Open Context Forge
────────────────────────────────────
Title
Medium · author · published date
word count · remote image count

opening excerpt
… omitted N characters …
closing excerpt

optional short note

[Save to capture queue]
Open queue
```

The user sees a compact preview before any record is saved. Closing the popup or pressing cancel leaves no queued record.

Preview behavior:

- Show the opening 500–700 Chinese characters and the closing 250–400 characters.
- Split at paragraph or sentence boundaries where possible; do not cut through a sentence merely to meet a fixed length.
- Collapse the middle to a character-count indicator.
- Represent long code blocks by a short fragment rather than rendering the whole block.
- Show word count and number of absolute remote image links.

The popup does not expose tagging, article editing, source adapters, AI features, settings, image lists, or sync configuration. Those belong to the queue page or a future management system.

### 5.2 States

The popup states are:

- `extracting`: show a short loading message.
- `ready`: show preview and the primary save button.
- `warning`: show a visible explanation but permit save, for example short content or a likely paywall preview.
- `duplicate`: show the existing record and the available update/version action.
- `failed`: show a readable capture error and no save button.
- `saved`: show the pending queue count and links to close or open the queue.

The queue page is a separate extension page, opened through a link in the popup. It supports filtering by status, opening the source, Markdown preview, editing a personal note, deletion, export, and future manual sync. It is intentionally not a general knowledge-management UI.

The queue page may open a record's source URL in a new tab, but it cannot re-capture that tab automatically: `activeTab` access requires the user to invoke the extension again on the newly active source tab. This preserves the minimum-permission model and makes the re-capture action explicit.

## 6. Capture and Markdown extraction

The capture pipeline is:

```text
popup
→ background service worker
→ programmatically injected content script
→ clone currently rendered document
→ normalize links and lazy image URLs
→ metadata extraction
→ article extraction
→ Markdown conversion
→ result returned to background
→ preview and, after confirmation, IndexedDB persistence
```

### 6.1 Metadata

Collect, when available:

- original URL and canonical URL;
- title;
- author;
- site name;
- published date;
- language;
- capture timestamp.

Metadata resolution prefers canonical link and JSON-LD, then OpenGraph and ordinary meta tags, then document fallbacks. The original URL is retained even when a canonical URL is found.

### 6.2 Article content

The content script works only with a clone of the DOM so that the visible page is not modified. Before article extraction it:

1. Replaces lazy image fields with the best currently rendered source (`currentSrc`, then supported lazy-load attributes, then `src`).
2. Resolves relative `href` and `src` values against the page base URL.
3. Removes scripts, forms, decorative controls, and other non-article nodes from the clone.
4. Uses Readability to identify the article body.
5. Uses a Medium fallback that prefers a rendered article element and Medium metadata when generic extraction is insufficient.
6. Converts the resulting HTML with Turndown plus GitHub-Flavored Markdown rules for tables, strikethrough, fenced code, lists, links, and images.
7. Calculates word count, image URL list, warnings, and a SHA-256 hash of normalized Markdown.

Each Markdown image remains a remote absolute URL. The capture record deliberately does not fetch or retain image bytes. If a page provides only an inaccessible image source, the URL is still retained and a warning is recorded if appropriate.

The extension captures only content the user can already see. It does not bypass authentication, paid-content gates, or anti-bot protections. A short result, login wall, or probable paywall preview produces a visible warning.

## 7. Offline data model and queue behavior

### 7.1 Storage

Use IndexedDB, under the extension origin, as the source of truth for capture records. `chrome.storage.local` stores only small settings and cached UI state such as the queue count. IndexedDB is used because it handles collections and article-sized text safely without treating `chrome.storage.local` as a document store.

The database contains a `captures` object store keyed by `id`, with indexes for `delivery.status`, `source.canonicalUrl`, `capture.contentHash`, and `capture.capturedAt`.

```ts
interface CaptureRecord {
  schemaVersion: 1
  id: string

  source: {
    originalUrl: string
    canonicalUrl: string
    title: string
    author?: string
    siteName?: string
    publishedAt?: string
    language?: string
  }

  content: {
    markdown: string
    excerpt?: string
    wordCount: number
    imageUrls: string[]
  }

  user: {
    note?: string
  }

  capture: {
    capturedAt: string
    extractor: "readability" | "site-adapter" | "fallback"
    contentHash: string
    warnings: string[]
  }

  delivery: {
    status: "queued" | "duplicate" | "syncing" | "synced" | "failed"
    attempts: number
    lastAttemptAt?: string
    lastError?: string
    remoteId?: string
  }

  supersedes?: string
  duplicateOf?: string
}
```

No confirmed record is deleted automatically while it is `queued` or `failed`. `synced` records remain locally for seven days and can be removed earlier by the user. The queue page warns that uninstalling the extension clears extension-local IndexedDB data.

### 7.2 Duplicate and version rules

- Same canonical URL and same content hash: do not create a record; show the existing capture.
- Same canonical URL and a changed content hash while the earlier record is unsynced: update the existing unsynced record. Here, unsynced means `queued` or `failed`; reset its delivery state to `queued`, set `attempts` to `0`, and clear `lastAttemptAt`, `lastError`, and `remoteId`.
- Same canonical URL and a changed content hash after sync: create a new record with `supersedes` pointing to the former record.
- Different URLs with the same content hash: create a new record with `delivery.status = "duplicate"` and `duplicateOf` pointing to the first record. The queue presents it as a duplicate candidate; the user may delete it or explicitly promote it to `queued` to preserve the source independently. Duplicate candidates are excluded from default batch export and future synchronization.
- If no canonical URL exists, use the source URL after removing fragments and common tracking parameters for duplicate comparisons.

### 7.3 Errors

Failure is explicit, never silent. Capture failures include a page identifier and machine-readable error code but no invalid article body. Relevant cases are:

- no readable article found;
- extracted content too short;
- likely login or paywall preview;
- empty Markdown after conversion;
- tab closed during capture;
- IndexedDB persistence failure.

The queue can open the original URL, after which the user may run a new explicit capture from that source tab. A failed future sync never prevents a new capture.

## 8. Export and future Companion integration

Until the management system exists, the queue provides:

- Markdown export for one capture;
- JSON export for selected or all capture records.

The future integration boundary is typed but not implemented in v0.1:

```text
GET  /api/v1/health
POST /api/v1/captures:batch
```

The later batch request will contain each record's stable `id` and `contentHash`; the Companion must process it idempotently. It returns an individual result for each record:

```json
{
  "results": [
    {
      "id": "capture-id",
      "status": "accepted",
      "inboxId": "backend-inbox-id"
    }
  ]
}
```

Expected statuses are `accepted`, `duplicate`, `rejected`, and `retryable_error`. The future client will batch at most 20 records or 5 MB per request, mark records `syncing` only during an explicit user request, and return failed records to `queued` or `failed` as appropriate. No background polling or automatic work is part of the v0.1 extension.

## 9. Tests and acceptance criteria

### Automated tests

Use fixture-based tests for:

- canonical, OpenGraph, and JSON-LD metadata extraction;
- absolute conversion of links and image URLs;
- current source, `srcset`, and supported lazy image attributes;
- Markdown conversion for headings, paragraphs, lists, quotations, code, tables, links, and images;
- generic article and Medium-style rendered DOM extraction;
- short-content and login/paywall warnings;
- head-and-tail preview truncation;
- URL normalization, content hashing, duplicate detection, and record versioning;
- IndexedDB CRUD and queue-state transitions;
- batch export serialization.

The build must validate the Manifest V3 output and make the extension loadable from `dist/`.

### Manual verification

1. Run the automated test suite and production build.
2. Load `dist/` through Chrome's **Load unpacked** flow.
3. With an existing Medium login, open an article and verify title, author, article preview, Markdown, and remote image URLs.
4. Capture multiple articles while no Companion process is running.
5. Restart Chrome and confirm queued records remain available.
6. Verify deletion, opening a source then explicitly capturing it again, Markdown export, batch JSON export, unchanged duplicate detection, duplicate-candidate promotion, and changed-content version creation.
7. Confirm a failed or unavailable future backend path cannot block capture.

### Definition of done

v0.1 is complete when:

1. Chrome loads the locally built extension without manifest errors.
2. A Medium article and a generic technical article both produce a compact preview before persistence.
3. User confirmation writes a full Markdown record, remote image URLs, metadata, and optional note to IndexedDB.
4. Closing the popup before confirmation leaves no capture record.
5. Offline captures survive a browser restart.
6. The queue page can inspect, open the source of, delete, and export records; re-capture requires an explicit user action on the opened source tab.
7. Duplicate and changed-content behavior follows section 7.2.
8. The extension sends no data externally by default.
9. Tests and production build pass.
10. The extension README documents local installation, use, data retention, and known limitations.

## 10. Implementation sequence

The implementation plan should keep the work in this order:

1. Establish the isolated extension package, build output, manifest, and test harness.
2. Implement pure URL, metadata, preview, hashing, and duplicate functions with tests.
3. Implement DOM extraction and Markdown conversion against fixtures.
4. Implement IndexedDB persistence and queue-state tests.
5. Implement popup preview and confirmation flow.
6. Implement the queue page and export features.
7. Add a typed future-sync adapter without making a backend required.
8. Build, load unpacked, execute manual capture checks, and document the result.
