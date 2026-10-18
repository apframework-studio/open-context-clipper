> 历史归档：本文是旧仓库的已执行计划，不要在新仓库重新执行其中的创建与提交步骤。请先读 `AGENTS.md` 与 `docs/HANDOFF.md`。

# Chrome Capture Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally loadable Chrome Manifest V3 extension that previews and saves the rendered article in the active tab as an offline Markdown capture record.

**Architecture:** The popup asks a Manifest V3 service worker to inject a content script into the user-selected active tab. The content script extracts metadata and article Markdown from a cloned DOM; the popup renders a text-only head-and-tail preview and only asks the service worker to persist the full result after the user confirms. IndexedDB stores confirmed records and a separate queue page manages local records and exports. A typed Companion client establishes a future batch-sync boundary without requesting network permissions or requiring a Companion process in v0.1.

**Tech Stack:** TypeScript (strict), Chrome Manifest V3, esbuild, Vitest, jsdom, fake-indexeddb, Mozilla Readability, Turndown, and turndown-plugin-gfm.

**Spec:** [迁出前的设计文档](chrome-capture-extension-design.md)

## Global Constraints

- Create all extension product code under `apps/chrome-extension/`; do not change `vault/`, `skills/`, `workflows/`, or existing writing projects for this feature.
- Use Manifest V3 and request exactly `activeTab`, `scripting`, and `storage` permissions in v0.1.
- Read the active page only after the user opens the extension popup; do not request cookies, history, broad host permissions, downloads, notifications, or remote-code permissions.
- Convert cleaned rendered HTML to Markdown and preserve absolute remote image URLs; never download image binaries or retain an HTML snapshot.
- The extension must persist no article text before the user presses the confirmation button in the popup.
- The queue must work when no Companion process is running and must not send article text off-device by default.
- Keep all user-facing extension text in Chinese.
- Use explicit, user-triggered re-capture: the queue page can open a source URL, but the user must invoke the extension on that source tab again.
- Keep generated `apps/chrome-extension/dist/` and dependency directories untracked; commit the lockfile.

---

## Planned File Structure

```text
apps/chrome-extension/
  .gitignore                         # excludes dist/ and node_modules/
  package.json                       # isolated extension scripts and dependencies
  package-lock.json                  # reproducible npm dependency graph
  tsconfig.json                      # strict TypeScript configuration
  manifest.json                      # MV3 metadata and minimal permissions
  scripts/build.mjs                  # bundles scripts and copies extension pages
  popup.html                         # single-page capture preview shell
  queue.html                         # local capture queue shell
  src/
    background/service-worker.ts     # Chrome message router and badge updates
    content/capture-page.ts          # injected capture message listener
    extraction/article-extractor.ts  # cloned-DOM extraction and Markdown conversion
    extraction/metadata.ts           # canonical, JSON-LD, OpenGraph metadata resolution
    extraction/dom-normalizer.ts     # lazy-image and relative URL normalization
    popup/main.ts                    # popup state and confirmation controller
    popup/styles.css                 # popup-only presentation
    queue/main.ts                    # queue list and local-record actions
    queue/styles.css                 # queue-only presentation
    queue/export.ts                  # Markdown and JSON browser exports
    storage/capture-repository.ts    # IndexedDB schema and duplicate/version rules
    sync/companion-client.ts         # typed, unused future local API client
    sync/types.ts                    # future Companion request and response models
    shared/hash.ts                   # SHA-256 digest helper
    shared/messages.ts               # extension message contracts
    shared/models.ts                 # capture and delivery domain types
    shared/preview.ts                # text-only head-and-tail preview function
    shared/url.ts                    # canonical comparison URL normalization
    types/turndown-plugin-gfm.d.ts   # declaration for the GFM plugin
  tests/
    build-output.test.ts             # built extension output checks
    helpers/chrome.ts                # narrow Chrome API fake used by controllers
    helpers/indexeddb.ts             # fake IndexedDB reset helper
    fixtures/generic-article.html    # generic article extraction fixture
    fixtures/medium-article.html     # Medium-shaped rendered DOM fixture
    fixtures/short-page.html         # login/paywall-like short-content fixture
    extraction/article-extractor.test.ts
    popup/main.test.ts
    queue/export.test.ts
    queue/main.test.ts
    shared/hash.test.ts
    shared/preview.test.ts
    shared/url.test.ts
    storage/capture-repository.test.ts
    sync/companion-client.test.ts
```

## Shared Interfaces

All later tasks use these names and fields exactly.

```ts
// src/shared/models.ts
export type DeliveryStatus = "queued" | "duplicate" | "syncing" | "synced" | "failed";

export interface SourceMetadata {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  author?: string;
  siteName?: string;
  publishedAt?: string;
  language?: string;
}

export interface CapturedContent {
  markdown: string;
  excerpt?: string;
  wordCount: number;
  imageUrls: string[];
}

export interface ExtractedCapture {
  source: SourceMetadata;
  content: CapturedContent;
  capture: {
    capturedAt: string;
    extractor: "readability" | "site-adapter" | "fallback";
    contentHash: string;
    warnings: string[];
  };
}

export interface CaptureRecord extends ExtractedCapture {
  schemaVersion: 1;
  id: string;
  user: { note?: string };
  delivery: {
    status: DeliveryStatus;
    attempts: number;
    lastAttemptAt?: string;
    lastError?: string;
    remoteId?: string;
  };
  supersedes?: string;
  duplicateOf?: string;
}

export type SaveOutcome =
  | { kind: "saved"; record: CaptureRecord }
  | { kind: "unchanged-duplicate"; record: CaptureRecord }
  | { kind: "updated-unsynced"; record: CaptureRecord }
  | { kind: "new-version"; record: CaptureRecord }
  | { kind: "duplicate-candidate"; record: CaptureRecord };
```

```ts
// src/shared/messages.ts
export type ExtensionRequest =
  | { type: "EXTRACT_ACTIVE_TAB" }
  | { type: "SAVE_CAPTURE"; extracted: ExtractedCapture; note?: string }
  | { type: "GET_QUEUE_COUNT" }
  | { type: "LIST_CAPTURES"; status?: DeliveryStatus }
  | { type: "UPDATE_CAPTURE_NOTE"; id: string; note?: string }
  | { type: "DELETE_CAPTURE"; id: string }
  | { type: "PROMOTE_DUPLICATE"; id: string }
  | { type: "OPEN_QUEUE" }
  | { type: "OPEN_SOURCE"; url: string };

export type ExtensionResponse =
  | { ok: true; type: "EXTRACTION"; extracted: ExtractedCapture }
  | { ok: true; type: "SAVED"; outcome: SaveOutcome }
  | { ok: true; type: "QUEUE_COUNT"; count: number }
  | { ok: true; type: "CAPTURES"; records: CaptureRecord[] }
  | { ok: true; type: "RECORD"; record: CaptureRecord }
  | { ok: true; type: "OPENED" }
  | { ok: false; code: string; message: string };
```

---

### Task 1: Create the isolated extension package and verify loadable build output

**Files:**

- Create: `apps/chrome-extension/.gitignore`
- Create: `apps/chrome-extension/package.json`
- Create: `apps/chrome-extension/package-lock.json`
- Create: `apps/chrome-extension/tsconfig.json`
- Create: `apps/chrome-extension/manifest.json`
- Create: `apps/chrome-extension/popup.html`
- Create: `apps/chrome-extension/queue.html`
- Create: `apps/chrome-extension/scripts/build.mjs`
- Create: `apps/chrome-extension/src/background/service-worker.ts`
- Create: `apps/chrome-extension/src/popup/main.ts`
- Create: `apps/chrome-extension/src/queue/main.ts`
- Create: `apps/chrome-extension/tests/build-output.test.ts`

**Interfaces:**

- Consumes: none.
- Produces: `npm run build`, `npm test`, `npm run typecheck`, and a `dist/` directory with `manifest.json`, `background.js`, `popup.html`, `popup.js`, `queue.html`, and `queue.js`.

- [ ] **Step 1: Initialize the isolated npm package and install exact library categories**

  From `apps/chrome-extension/`, run:

  ```bash
  npm init -y
  npm install @mozilla/readability turndown turndown-plugin-gfm fake-indexeddb
  npm install --save-dev @types/chrome @types/turndown esbuild jsdom typescript vitest
  ```

  Set package scripts to:

  ```json
  {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
  ```

  Put `node_modules/` and `dist/` in `.gitignore`. Keep `package-lock.json` tracked.

- [ ] **Step 2: Write the failing build-output test**

  Create `tests/build-output.test.ts`:

  ```ts
  import { existsSync, readFileSync } from "node:fs";
  import { resolve } from "node:path";
  import { describe, expect, it } from "vitest";

  const dist = resolve(import.meta.dirname, "..", "dist");

  describe("extension build", () => {
    it("emits a loadable MV3 manifest and every declared entrypoint", () => {
      expect(existsSync(resolve(dist, "manifest.json"))).toBe(true);
      const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.background.service_worker).toBe("background.js");
      expect(manifest.action.default_popup).toBe("popup.html");
      for (const file of ["background.js", "popup.html", "popup.js", "queue.html", "queue.js"]) {
        expect(existsSync(resolve(dist, file))).toBe(true);
      }
    });
  });
  ```

- [ ] **Step 3: Run the test before creating the build output**

  Run from `apps/chrome-extension/`:

  ```bash
  npm test -- tests/build-output.test.ts
  ```

  Expected: failure because `dist/manifest.json` does not yet exist.

- [ ] **Step 4: Add strict compiler and MV3 build configuration**

  Create `tsconfig.json` with `strict: true`, `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `lib: ["ES2022", "DOM"]`, and `noEmit: true`.

  Create `manifest.json` with:

  ```json
  {
    "manifest_version": 3,
    "name": "Open Context Forge Clipper",
    "version": "0.1.0",
    "description": "本地离线采集当前网页正文。",
    "permissions": ["activeTab", "scripting", "storage"],
    "background": { "service_worker": "background.js", "type": "module" },
    "action": { "default_popup": "popup.html", "default_title": "采集当前文章" }
  }
  ```

  Make `popup.html` and `queue.html` contain only a root `<main>` element and a module script (`/popup.js` or `/queue.js`). Make the initial TypeScript entries render a Chinese placeholder into their root elements.

  Implement `scripts/build.mjs` with three esbuild entry points:

  ```js
  await esbuild.build({
    entryPoints: {
      background: "src/background/service-worker.ts",
      popup: "src/popup/main.ts",
      queue: "src/queue/main.ts"
    },
    bundle: true,
    format: "esm",
    target: "chrome120",
    outdir: "dist",
    sourcemap: true
  });
  ```

  Copy `manifest.json`, `popup.html`, and `queue.html` into `dist/` after bundling. Later tasks add the `content` entry point to this script.

- [ ] **Step 5: Run the build, type check, and build-output test**

  Run:

  ```bash
  npm run typecheck
  npm run build
  npm test -- tests/build-output.test.ts
  ```

  Expected: all commands pass; `dist/manifest.json` contains exactly the three approved permissions.

- [ ] **Step 6: Commit the isolated package baseline**

  ```bash
  git add apps/chrome-extension
  git commit -m "feat(clipper): scaffold local Chrome extension"
  ```

### Task 2: Define shared capture models and pure URL, hash, and preview utilities

**Files:**

- Create: `apps/chrome-extension/src/shared/models.ts`
- Create: `apps/chrome-extension/src/shared/url.ts`
- Create: `apps/chrome-extension/src/shared/hash.ts`
- Create: `apps/chrome-extension/src/shared/preview.ts`
- Create: `apps/chrome-extension/tests/shared/url.test.ts`
- Create: `apps/chrome-extension/tests/shared/hash.test.ts`
- Create: `apps/chrome-extension/tests/shared/preview.test.ts`

**Interfaces:**

- Consumes: Task 1 TypeScript and Vitest setup.
- Produces: the `CaptureRecord`, `ExtractedCapture`, `SaveOutcome`, `normalizeComparisonUrl`, `sha256Hex`, and `createTextPreview` interfaces used by Tasks 3–8.

- [ ] **Step 1: Write failing pure-function tests**

  Add these representative assertions:

  ```ts
  // tests/shared/url.test.ts
  expect(normalizeComparisonUrl("https://example.com/a/?utm_source=x&ref=mail#part"))
    .toBe("https://example.com/a");

  // tests/shared/hash.test.ts
  await expect(sha256Hex("文章\n\n正文")).resolves.toMatch(/^[a-f0-9]{64}$/);

  // tests/shared/preview.test.ts
  expect(createTextPreview("第一段。\n\n第二段。\n\n第三段。", 4, 4)).toEqual({
    opening: "第一段。",
    omittedCharacters: 4,
    closing: "第三段。"
  });
  ```

- [ ] **Step 2: Run the shared tests and verify they fail**

  ```bash
  npm test -- tests/shared/url.test.ts tests/shared/hash.test.ts tests/shared/preview.test.ts
  ```

  Expected: failure because the shared modules do not exist.

- [ ] **Step 3: Implement domain models and URL normalization**

  Copy the `DeliveryStatus`, `SourceMetadata`, `CapturedContent`, `ExtractedCapture`, `CaptureRecord`, and `SaveOutcome` definitions from the Shared Interfaces section into `src/shared/models.ts`.

  Implement `normalizeComparisonUrl(raw: string): string` in `src/shared/url.ts` to:

  1. parse with `new URL(raw)`;
  2. remove `hash`;
  3. remove query parameters whose lowercase key starts with `utm_` and the keys `fbclid`, `gclid`, `mc_cid`, `mc_eid`, and `ref`;
  4. remove a trailing slash from non-root pathnames;
  5. return `url.toString()` with an empty query string.

- [ ] **Step 4: Implement SHA-256 and preview behavior**

  Implement:

  ```ts
  export async function sha256Hex(input: string): Promise<string> {
    const bytes = new TextEncoder().encode(input.replace(/\r\n/g, "\n").trim());
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  ```

  Implement `createTextPreview(markdown, openingLimit = 650, closingLimit = 320)` by converting Markdown into collapsed plain text, choosing a paragraph or sentence boundary at or before each limit when one exists, and returning the whole text as `opening` with `omittedCharacters: 0` when it fits. Never return untrusted HTML.

- [ ] **Step 5: Run tests, type check, and commit**

  ```bash
  npm test -- tests/shared/url.test.ts tests/shared/hash.test.ts tests/shared/preview.test.ts
  npm run typecheck
  git add apps/chrome-extension/src/shared apps/chrome-extension/tests/shared
  git commit -m "feat(clipper): add capture domain utilities"
  ```

  Expected: all three test files and strict type checking pass.

### Task 3: Extract metadata and article Markdown from a cloned rendered DOM

**Files:**

- Create: `apps/chrome-extension/src/types/turndown-plugin-gfm.d.ts`
- Create: `apps/chrome-extension/src/extraction/metadata.ts`
- Create: `apps/chrome-extension/src/extraction/dom-normalizer.ts`
- Create: `apps/chrome-extension/src/extraction/article-extractor.ts`
- Create: `apps/chrome-extension/src/content/capture-page.ts`
- Create: `apps/chrome-extension/tests/fixtures/generic-article.html`
- Create: `apps/chrome-extension/tests/fixtures/medium-article.html`
- Create: `apps/chrome-extension/tests/fixtures/short-page.html`
- Create: `apps/chrome-extension/tests/extraction/article-extractor.test.ts`
- Modify: `apps/chrome-extension/scripts/build.mjs`

**Interfaces:**

- Consumes: `ExtractedCapture`, `normalizeComparisonUrl`, and `sha256Hex` from Task 2.
- Produces: `extractCaptureFromDocument(document, originalUrl)` and the content-script listener consumed by Task 5.

- [ ] **Step 1: Write failing extraction tests against realistic fixtures**

  Create a generic fixture with canonical, OpenGraph, JSON-LD, a relative article link, a lazy-loaded relative image (`data-src`), a fenced-code-equivalent `<pre><code>`, and a table. Create a Medium-shaped fixture with a rendered `<article>`, canonical URL, author link, time element, and `img srcset`. Create a short login-like fixture with fewer than 200 readable characters.

  Test the public API:

  ```ts
  const result = await extractCaptureFromDocument(document, "https://example.com/post?utm_source=newsletter");
  expect(result.source.canonicalUrl).toBe("https://example.com/canonical-post");
  expect(result.source.author).toBe("张三");
  expect(result.content.markdown).toContain("[相关链接](https://example.com/docs)");
  expect(result.content.markdown).toContain("![架构图](https://cdn.example.com/diagram.png)");
  expect(result.content.markdown).toContain("```ts");
  expect(result.capture.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.capture.warnings).toContain("content_too_short");
  ```

- [ ] **Step 2: Run extraction tests and verify they fail**

  ```bash
  npm test -- tests/extraction/article-extractor.test.ts
  ```

  Expected: failure because the extraction API does not exist.

- [ ] **Step 3: Implement metadata and cloned-DOM normalization**

  In `metadata.ts`, export `extractMetadata(document, originalUrl): SourceMetadata`. Resolve canonical URL in this order: `<link rel="canonical">`, JSON-LD `mainEntityOfPage`, `og:url`, normalized original URL. Resolve title in this order: JSON-LD `headline`, `og:title`, document title. Extract author, site name, publication date, and document language from JSON-LD, OpenGraph, standard metadata, and the Medium `article` fallback.

  In `dom-normalizer.ts`, export `prepareArticleClone(document): Document`. Clone the document, remove `script`, `style`, `form`, `nav`, `aside`, and `button` nodes from the clone, select the first non-empty value from `img.currentSrc`, `data-src`, `data-original`, and `src`, then write it to `src`. Convert every anchor `href` and image `src` to an absolute URL using the clone's base URI. Do not make network requests.

- [ ] **Step 4: Implement Readability, Medium fallback, and Markdown conversion**

  Implement:

  ```ts
  export async function extractCaptureFromDocument(
    document: Document,
    originalUrl: string,
    capturedAt = new Date().toISOString()
  ): Promise<ExtractedCapture>;
  ```

  It must call `prepareArticleClone`, then `new Readability(clone).parse()`. If the result is empty or too short and the clone contains a non-empty `article`, use that article's HTML and set `extractor: "site-adapter"` for Medium-shaped pages or `"fallback"` otherwise. Configure Turndown with GFM rules, `codeBlockStyle: "fenced"`, and `emDelimiter: "_"`. Collect absolute image URLs from the converted article, count CJK characters plus whitespace-separated non-CJK words, create an excerpt from the first 240 plain-text characters, calculate the content hash, and add `content_too_short` for readable text below 200 characters.

  Add a content-script entry that listens once for `{ type: "EXTRACT_DOCUMENT" }`, runs `extractCaptureFromDocument(document, location.href)`, and responds with a serializable `ExtractedCapture`. Guard duplicate listener registration with a property on `globalThis`.

- [ ] **Step 5: Add the content-script bundle and validate behavior**

  Add `content: "src/content/capture-page.ts"` to the esbuild entry points so the generated file is `dist/content.js`. Extend `tests/build-output.test.ts` to require `content.js`.

  Run:

  ```bash
  npm test -- tests/extraction/article-extractor.test.ts tests/build-output.test.ts
  npm run typecheck
  npm run build
  ```

  Expected: fixtures verify generic and Medium-style extraction, short-page warnings, absolute links, remote image URLs, and loadable content-script output.

- [ ] **Step 6: Commit extraction behavior**

  ```bash
  git add apps/chrome-extension/src/extraction apps/chrome-extension/src/content apps/chrome-extension/src/types apps/chrome-extension/tests/fixtures apps/chrome-extension/tests/extraction apps/chrome-extension/scripts/build.mjs apps/chrome-extension/tests/build-output.test.ts
  git commit -m "feat(clipper): extract rendered articles as Markdown"
  ```

### Task 4: Persist confirmed captures in IndexedDB with deterministic duplicate and version rules

**Files:**

- Create: `apps/chrome-extension/src/storage/capture-repository.ts`
- Create: `apps/chrome-extension/tests/helpers/indexeddb.ts`
- Create: `apps/chrome-extension/tests/storage/capture-repository.test.ts`

**Interfaces:**

- Consumes: Task 2 domain types and URL/hash utilities; `ExtractedCapture` from Task 3.
- Produces: `CaptureRepository`, `saveConfirmed(extracted, note)`, `list()`, `get()`, `updateNote()`, `delete()`, `promoteDuplicate()`, and `countByStatus()` for Tasks 5–7.

- [ ] **Step 1: Write failing repository behavior tests**

  Use `fake-indexeddb/auto` in the test helper and reset the database before every test. Cover these exact outcomes:

  ```ts
  await expect(repository.saveConfirmed(first, "重点阅读")).resolves.toMatchObject({ kind: "saved" });
  await expect(repository.saveConfirmed(sameUrlSameHash)).resolves.toMatchObject({ kind: "unchanged-duplicate" });
  await expect(repository.saveConfirmed(sameUrlChangedHashQueued)).resolves.toMatchObject({ kind: "updated-unsynced" });
  await expect(repository.saveConfirmed(sameUrlChangedHashSynced)).resolves.toMatchObject({ kind: "new-version" });
  await expect(repository.saveConfirmed(differentUrlSameHash)).resolves.toMatchObject({ kind: "duplicate-candidate" });
  ```

  Assert that an updated unsynced record resets delivery to `{ status: "queued", attempts: 0 }` and clears `lastAttemptAt`, `lastError`, and `remoteId`; assert that a duplicate candidate has `delivery.status === "duplicate"` and `duplicateOf` set to the first record ID.

- [ ] **Step 2: Run repository tests and verify they fail**

  ```bash
  npm test -- tests/storage/capture-repository.test.ts
  ```

  Expected: failure because `CaptureRepository` does not exist.

- [ ] **Step 3: Implement the IndexedDB schema and CRUD methods**

  Implement `CaptureRepository` over a database named `ocf-clipper` and an object store named `captures` with key path `id`. During upgrade, create indexes named `status`, `canonicalUrl`, `contentHash`, and `capturedAt` for `delivery.status`, `source.canonicalUrl`, `capture.contentHash`, and `capture.capturedAt`.

  `saveConfirmed(extracted, note)` must create records with `schemaVersion: 1`, `crypto.randomUUID()`, `user.note`, and `delivery: { status: "queued", attempts: 0 }`. Query by canonical URL and content hash to apply the four rule outcomes specified in the tests. When promoting a duplicate candidate, change only `delivery.status` to `queued` and retain `duplicateOf` as provenance of the original duplicate decision.

- [ ] **Step 4: Run repository tests and type check**

  ```bash
  npm test -- tests/storage/capture-repository.test.ts
  npm run typecheck
  ```

  Expected: all duplicate, update, version, promotion, CRUD, and count assertions pass.

- [ ] **Step 5: Commit offline persistence**

  ```bash
  git add apps/chrome-extension/src/storage apps/chrome-extension/tests/helpers/indexeddb.ts apps/chrome-extension/tests/storage
  git commit -m "feat(clipper): store captures in offline queue"
  ```

### Task 5: Wire Chrome messaging, explicit active-tab injection, and queue badge updates

**Files:**

- Create: `apps/chrome-extension/src/shared/messages.ts`
- Create: `apps/chrome-extension/tests/helpers/chrome.ts`
- Create: `apps/chrome-extension/tests/background/service-worker.test.ts`
- Modify: `apps/chrome-extension/src/background/service-worker.ts`

**Interfaces:**

- Consumes: `CaptureRepository` from Task 4, `ExtractedCapture` from Task 3, and the message contracts in the Shared Interfaces section.
- Produces: a `createBackgroundController(deps)` factory whose `handle(request)` returns `ExtensionResponse`; popup and queue pages use it through `chrome.runtime.sendMessage`, so every queue mutation refreshes the action badge.

- [ ] **Step 1: Write failing message-router tests with a narrow Chrome fake**

  Define a `ChromePort` abstraction in the service-worker module:

  ```ts
  export interface ChromePort {
    getActiveTab(): Promise<{ id?: number }>;
    injectCaptureScript(tabId: number): Promise<void>;
    requestExtraction(tabId: number): Promise<ExtractedCapture>;
    setBadge(count: number): Promise<void>;
    openExtensionPage(path: string): Promise<void>;
    openUrl(url: string): Promise<void>;
  }
  ```

  Test that `EXTRACT_ACTIVE_TAB` injects `content.js` and requests an extraction; test that `SAVE_CAPTURE`, `DELETE_CAPTURE`, and `PROMOTE_DUPLICATE` call the repository then set the badge to the queued count. Test `LIST_CAPTURES`, `UPDATE_CAPTURE_NOTE`, `OPEN_QUEUE`, `OPEN_SOURCE`, zero-tab failure, and repository failures.

- [ ] **Step 2: Run router tests and verify they fail**

  ```bash
  npm test -- tests/background/service-worker.test.ts
  ```

  Expected: failure because the controller and port abstraction do not exist.

- [ ] **Step 3: Implement message contracts and service-worker controller**

  Add exact `ExtensionRequest` and `ExtensionResponse` unions from the Shared Interfaces section. Implement `createBackgroundController({ chromePort, repository })`. For `EXTRACT_ACTIVE_TAB`, require `tab.id`, run `injectCaptureScript(tab.id)`, then `requestExtraction(tab.id)`.

  Implement the real `ChromePort` with `chrome.tabs.query({ active: true, currentWindow: true })`, `chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })`, `chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOCUMENT" })`, `chrome.action.setBadgeText`, and `chrome.tabs.create`. Add repository calls for `LIST_CAPTURES`, `UPDATE_CAPTURE_NOTE`, `DELETE_CAPTURE`, and `PROMOTE_DUPLICATE`; return `CAPTURES` or `RECORD` responses and refresh the badge after mutations. Register one `chrome.runtime.onMessage` listener that delegates to the controller and returns the response asynchronously.

  Do not store an extraction for `EXTRACT_ACTIVE_TAB`; persistence happens only when `SAVE_CAPTURE` arrives from the confirmed popup.

- [ ] **Step 4: Run router tests, build, and type check**

  ```bash
  npm test -- tests/background/service-worker.test.ts
  npm run typecheck
  npm run build
  ```

  Expected: messages work through fakes, and the build output keeps only the approved manifest permissions.

- [ ] **Step 5: Commit Chrome bridge behavior**

  ```bash
  git add apps/chrome-extension/src/background apps/chrome-extension/src/shared/messages.ts apps/chrome-extension/tests/helpers/chrome.ts apps/chrome-extension/tests/background
  git commit -m "feat(clipper): connect popup to active page capture"
  ```

### Task 6: Build the Chinese single-page popup with text-only preview and confirmation

**Files:**

- Modify: `apps/chrome-extension/popup.html`
- Create: `apps/chrome-extension/src/popup/styles.css`
- Modify: `apps/chrome-extension/src/popup/main.ts`
- Create: `apps/chrome-extension/tests/popup/main.test.ts`

**Interfaces:**

- Consumes: `ExtensionRequest`, `ExtensionResponse`, and `createTextPreview` from Tasks 2 and 5.
- Produces: `createPopupController(deps)` with `load()`, `save(note)`, and `openQueue()` methods; a popup that never stores source content before confirmation.

- [ ] **Step 1: Write failing popup controller and DOM tests**

  Use jsdom and a fake message client. Test:

  ```ts
  await controller.load();
  expect(root.textContent).toContain("正在识别正文");
  expect(root.textContent).toContain("已省略");
  expect(root.textContent).toContain("保存到采集队列");
  expect(fake.requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }]);

  await controller.save("面向上下文工程");
  expect(fake.requests.at(-1)).toMatchObject({ type: "SAVE_CAPTURE", note: "面向上下文工程" });
  ```

  Add a separate assertion that closing before `save()` sends no `SAVE_CAPTURE` request, and an assertion that the preview uses `textContent` rather than assigning source content to `innerHTML`.

- [ ] **Step 2: Run popup tests and verify they fail**

  ```bash
  npm test -- tests/popup/main.test.ts
  ```

  Expected: failure because the popup controller and DOM rendering do not exist.

- [ ] **Step 3: Implement focused popup states and markup**

  Implement a 420px-wide popup with one `<main>` root. On startup, call `EXTRACT_ACTIVE_TAB` and render these Chinese states:

  - `正在识别正文…`
  - title, site, author, published date, word count, and remote image count;
  - opening text, `··· 已省略 N 字 ···`, and closing text;
  - warning text for every extraction warning;
  - one optional note input with `maxlength="280"`;
  - `保存到采集队列` as the sole primary action;
  - `打开队列` as a secondary action;
  - success confirmation with current queued count.

  Render all source-derived values using `textContent`. Disable the primary button while saving. On `unchanged-duplicate`, show `这篇文章已经采集，内容没有变化。`; on `new-version`, show `检测到正文变化，已保存为新版本。`; on `duplicate-candidate`, show `发现相同正文的另一来源，已作为重复候选保存。`.

- [ ] **Step 4: Run popup tests, full tests, and build**

  ```bash
  npm test -- tests/popup/main.test.ts
  npm test
  npm run typecheck
  npm run build
  ```

  Expected: a user can review a compact plain-text preview and no record is persisted until confirmation.

- [ ] **Step 5: Commit popup interaction**

  ```bash
  git add apps/chrome-extension/popup.html apps/chrome-extension/src/popup apps/chrome-extension/tests/popup
  git commit -m "feat(clipper): preview captures before saving"
  ```

### Task 7: Implement the local queue page, safe exports, and explicit source opening

**Files:**

- Modify: `apps/chrome-extension/queue.html`
- Create: `apps/chrome-extension/src/queue/styles.css`
- Create: `apps/chrome-extension/src/queue/export.ts`
- Modify: `apps/chrome-extension/src/queue/main.ts`
- Create: `apps/chrome-extension/tests/queue/export.test.ts`
- Create: `apps/chrome-extension/tests/queue/main.test.ts`

**Interfaces:**

- Consumes: `CaptureRecord`, `CAPTURES`, `RECORD`, and queue mutation requests from Task 5.
- Produces: `recordsToJson(records)`, `recordToMarkdown(record)`, and `createQueueController(deps)` with `load`, `filter`, `updateNote`, `remove`, `promoteDuplicate`, `openSource`, `exportOne`, and `exportSelected` methods.

- [ ] **Step 1: Write failing export and queue-controller tests**

  Add Markdown export assertions:

  ```ts
  expect(recordToMarkdown(record)).toContain("# 测试文章");
  expect(recordToMarkdown(record)).toContain("来源：https://example.com/article");
  expect(recordToMarkdown(record)).toContain("![图片](https://cdn.example.com/image.png)");
  expect(JSON.parse(recordsToJson([record]))[0].schemaVersion).toBe(1);
  ```

  Add controller assertions for status filtering, note persistence, duplicate promotion, deletion, and opening a source through `{ type: "OPEN_SOURCE", url }`. Use a fake message client and assert `UPDATE_CAPTURE_NOTE`, `PROMOTE_DUPLICATE`, and `DELETE_CAPTURE` requests are sent through the background route. Assert that the queue never claims it can silently re-capture an opened source.

- [ ] **Step 2: Run queue tests and verify they fail**

  ```bash
  npm test -- tests/queue/export.test.ts tests/queue/main.test.ts
  ```

  Expected: failure because export and queue controller modules do not exist.

- [ ] **Step 3: Implement deterministic Markdown and JSON export**

  Implement `recordToMarkdown(record)` with this stable header order:

  ```md
  # {title}

  - 来源：{originalUrl}
  - 采集时间：{capturedAt}
  - 作者：{author when present}
  - 备注：{note when present}

  ---

  {markdown}
  ```

  Implement `recordsToJson(records)` as pretty-printed JSON. In the browser, create download links with `URL.createObjectURL(new Blob(...))` and an `<a download>` element; do not add Chrome's `downloads` permission. Default batch exports exclude `delivery.status === "duplicate"`; expose promotion before export for a user who wants to preserve that alternative source.

- [ ] **Step 4: Implement the queue page**

  Render a simple Chinese local management view with filters for `待同步`, `重复候选`, `已同步`, and `失败`. Each row shows title, hostname, capture date, word count, status, note, and a short text-only excerpt. Provide buttons labelled `打开来源`, `保存备注`, `提升为独立记录` (only for duplicates), `导出 Markdown`, `删除`, and a selection-based `导出 JSON`.

  `打开来源` sends `OPEN_SOURCE` and then tells the user `页面打开后，请在该标签页再次点击插件进行采集。`. Do not add a re-capture button that would imply programmatic tab access.

- [ ] **Step 5: Run queue tests, full test suite, and build**

  ```bash
  npm test -- tests/queue/export.test.ts tests/queue/main.test.ts
  npm test
  npm run typecheck
  npm run build
  ```

  Expected: queue records remain local, exports preserve remote image links, and duplicate candidates require an explicit promotion to enter default export.

- [ ] **Step 6: Commit queue management**

  ```bash
  git add apps/chrome-extension/queue.html apps/chrome-extension/src/queue apps/chrome-extension/tests/queue
  git commit -m "feat(clipper): manage and export local capture queue"
  ```

### Task 8: Define and test the inactive future Companion sync contract

**Files:**

- Create: `apps/chrome-extension/src/sync/types.ts`
- Create: `apps/chrome-extension/src/sync/companion-client.ts`
- Create: `apps/chrome-extension/tests/sync/companion-client.test.ts`

**Interfaces:**

- Consumes: `CaptureRecord` from Task 2.
- Produces: `CompanionClient`, `selectSyncBatch`, `CompanionBatchRequest`, and `CompanionBatchResponse`; no v0.1 UI invokes this client.

- [ ] **Step 1: Write failing sync-contract tests**

  Add tests for the batch selection boundary:

  ```ts
  const batch = selectSyncBatch(records, { maxRecords: 20, maxBytes: 5 * 1024 * 1024 });
  expect(batch.records).toHaveLength(20);
  expect(batch.records.every((record) => record.delivery.status === "queued" || record.delivery.status === "failed")).toBe(true);
  expect(batch.records.some((record) => record.delivery.status === "duplicate")).toBe(false);
  ```

  Mock `fetch` and assert `CompanionClient.sendBatch` posts `id` and `contentHash`, parses `accepted`, `duplicate`, `rejected`, and `retryable_error` results, and never retries automatically.

- [ ] **Step 2: Run sync-contract tests and verify they fail**

  ```bash
  npm test -- tests/sync/companion-client.test.ts
  ```

  Expected: failure because the sync types and client do not exist.

- [ ] **Step 3: Implement types, deterministic batch selection, and explicit client methods**

  Define:

  ```ts
  export interface CompanionBatchRequest { records: CaptureRecord[]; }
  export interface CompanionBatchResult {
    id: string;
    status: "accepted" | "duplicate" | "rejected" | "retryable_error";
    inboxId?: string;
    message?: string;
  }
  export interface CompanionBatchResponse { results: CompanionBatchResult[]; }
  ```

  `selectSyncBatch` must order candidates by `capture.capturedAt`, include only `queued` and `failed` records, cap both record count and UTF-8 JSON byte count, and preserve at least one record only if it is within the byte limit. `CompanionClient` exposes `health()` and `sendBatch(records)` but must not be imported by the popup, queue, or service worker in v0.1. Do not add localhost host permissions to the manifest yet.

- [ ] **Step 4: Run sync tests and the full suite**

  ```bash
  npm test -- tests/sync/companion-client.test.ts
  npm test
  npm run typecheck
  ```

  Expected: the future protocol is deterministic and tested without a running local service or any browser network permission.

- [ ] **Step 5: Commit the future integration boundary**

  ```bash
  git add apps/chrome-extension/src/sync apps/chrome-extension/tests/sync
  git commit -m "feat(clipper): define future Companion sync contract"
  ```

### Task 9: Document local installation and perform end-to-end verification

**Files:**

- Create: `apps/chrome-extension/README.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: built `dist/` directory and every user interaction from Tasks 1–8.
- Produces: a repeatable local-install guide and a verified v0.1 delivery.

- [ ] **Step 1: Write the README verification checklist before finalizing documentation**

  In `apps/chrome-extension/README.md`, include a checklist whose unchecked initial items are:

  ```md
  - [ ] `npm test` passes.
  - [ ] `npm run typecheck` passes.
  - [ ] `npm run build` emits `dist/`.
  - [ ] Chrome loads `dist/` through `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序.
  - [ ] A logged-in Medium article and a generic public technical article show a preview before saving.
  - [ ] Captures remain present after restarting Chrome.
  ```

- [ ] **Step 2: Run the incomplete checklist commands and record the real results**

  From `apps/chrome-extension/`, run:

  ```bash
  npm test
  npm run typecheck
  npm run build
  ```

  Expected: all automated commands pass before manual Chrome validation begins.

- [ ] **Step 3: Complete the local-use documentation**

  Document:

  - prerequisites: Node/npm and Chrome;
  - installation and `npm run build` steps;
  - Load unpacked procedure using `apps/chrome-extension/dist/`;
  - popup flow: open extension, verify preview, optionally add note, save;
  - queue page, export, source opening, and explicit re-capture behavior;
  - privacy boundary: no cookies, no cloud transfer, no image download, data loss on extension uninstall;
  - known limitations: only rendered content is captured, paywall/login previews are not bypassed, and no Companion sync occurs in v0.1.

  Add a concise `Chrome Capture Extension` entry to the root `README.md` that links to `apps/chrome-extension/README.md` and states that it is a local experimental Capture Plane module.

- [ ] **Step 4: Perform manual Chrome verification**

  Load `dist/` in Chrome, then perform and record these checks in the extension README:

  1. Capture a Medium article visible under the user's existing login; verify title, author, opening and closing preview, remote image URLs, and a non-empty Markdown export.
  2. Capture a generic technical article with relative links and lazy images; verify exported Markdown contains absolute URLs.
  3. Close the popup before saving; verify no record appears in the queue.
  4. Save several captures with no Companion process running; restart Chrome and verify the queue remains.
  5. Capture the same page unchanged; verify no second ordinary queue record appears.
  6. Capture a changed version of a previously marked `synced` test record; verify a `supersedes` record is created through the repository test harness.
  7. Export selected records as JSON and a single record as Markdown; verify duplicate candidates are excluded unless promoted.

- [ ] **Step 5: Run final automated verification and inspect the working tree**

  ```bash
  npm test
  npm run typecheck
  npm run build
  git diff --check
  git status --short
  ```

  Expected: tests, strict type checking, and build pass; no generated `dist/` or `node_modules/` files are staged; unrelated vault-maintainer changes remain untouched.

- [ ] **Step 6: Commit docs and verified extension work**

  ```bash
  git add README.md apps/chrome-extension/README.md
  git commit -m "docs(clipper): document local Chrome capture workflow"
  ```

## Plan Self-Review

### Spec coverage

| Specification requirement | Implementation task |
| --- | --- |
| Isolated local MV3 extension and minimal permissions | Task 1 |
| Typed capture record, URL/hash/preview behavior | Task 2 |
| Logged-in rendered-DOM and Medium extraction to Markdown | Task 3 |
| No persistence before confirmation; offline IndexedDB queue | Tasks 4–6 |
| Exact duplicate, changed version, and duplicate-candidate behavior | Task 4 |
| Chinese compact preview and optional note | Task 6 |
| Queue, source opening, explicit re-capture, and local export | Task 7 |
| Future API contract without a backend or network permission | Task 8 |
| Build, automated checks, local Chrome validation, and user docs | Task 9 |

Every scope item in the design specification maps to at least one task. The plan deliberately excludes Companion implementation, vault writes, AI processing, Chrome Web Store publication, image downloads, cloud transfer, and automatic sync.

### Placeholder scan

Before executing this plan, run this command from the repository root:

```bash
rg -n "T[O]DO|T[B]D|implement[ ]later|fill[ ]in[ ]details|appropriate[ ]error[ ]handling|handle[ ]edge[ ]cases" docs/superpowers/plans/2026-09-19-chrome-capture-extension.md apps/chrome-extension
```

Expected: no matches in production extension code or this plan.

### Type consistency

- `ExtractedCapture` is created by `extractCaptureFromDocument`, returned as `EXTRACTION`, and accepted by `SAVE_CAPTURE`.
- `CaptureRepository.saveConfirmed` returns `SaveOutcome`, which is returned as `SAVED` and rendered in the popup.
- `CaptureRecord.delivery.status` is used consistently by repository rules, queue filters, exports, and future batch selection.
- `duplicateOf` is retained when a duplicate candidate is promoted; `supersedes` is reserved for a changed capture after a synced prior version.
- Only `ChromePort` calls the Chrome APIs. Extraction, persistence, popup, queue, export, and future sync are testable through their typed interfaces.
