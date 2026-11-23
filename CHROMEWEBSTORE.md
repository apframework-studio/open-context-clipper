# Chrome Web Store submission draft

Language: **English** · [中文使用说明](README.zh-CN.md)

This is copy for the Chrome Web Store Developer Dashboard. The store's default listing language should be English. Keep the Chinese guide available through the URL below. Check each field against the final uploaded package before submission.

## Store listing

**Name:** Open Context Clipper

**Short description:** Clip web articles to local Markdown. Preview, save to a private queue, or export individual and batch files.

**Category:** Productivity

**Detailed description:**

> Save the articles you choose as portable Markdown, without an account or cloud service.
>
> Open Context Clipper extracts the article already visible in your current Chrome tab when you click the extension. Review the title, source, article preview, and any extraction warnings before taking action.
>
> • Download the current article as Markdown immediately, without adding it to the queue.
> • Save articles to a local queue to search, review, and export later.
> • Export one article as Markdown, or selected articles as a ZIP or JSON file.
> • Keep recently exported articles in Completed for quick access. Optional 30-day or 90-day cleanup applies only to Completed records.
> • Choose an English or Simplified Chinese interface.
>
> Article extraction and queue storage happen on your device. The extension does not upload article content to a developer server. It requests temporary access to the current tab only after you click it. Markdown preserves links to remote images rather than downloading the image files.
>
> Chinese guide: https://github.com/apframework-studio/open-context-clipper/blob/main/README.zh-CN.md
> Privacy policy: https://github.com/apframework-studio/open-context-clipper/blob/main/PRIVACY.md

**Homepage URL:** https://github.com/apframework-studio/open-context-clipper

**Support URL:** https://github.com/apframework-studio/open-context-clipper/issues

**Privacy policy URL:** https://github.com/apframework-studio/open-context-clipper/blob/main/PRIVACY.md

The privacy policy is published in the public repository and can be opened without signing in.

**Store assets:** use `icons/icon-128.png` from the release package, [English preview screenshot](docs/webstore/preview-en-1280x800.png), [English queue screenshot](docs/webstore/queue-en-1280x800.png), and [440×280 promotional tile](docs/webstore/promo-tile.png). The two screenshots use [original fictional demo content](docs/webstore/sample-content.md), so they contain no captured third-party article or private queue data.

## Privacy practices

**Single purpose:** Let users extract an article from the current tab on demand, manage selected captures locally, and export them as portable files.

**`activeTab` justification:** Grants temporary access only to the active page the user chooses by clicking the extension, so its rendered article can be previewed and exported.

**`scripting` justification:** Injects the packaged extraction script into that active tab after the user clicks the extension. The script reads the rendered page to produce the preview and Markdown.

**`storage` justification:** Saves interface language and completed-history retention preferences in Chrome's local extension storage. Saved article records use the extension's local IndexedDB.

**Remote code:** No. The extension runs packaged code; it does not fetch executable code from a remote server.

**User data:** Disclose handling of the current page's content and URL, extracted metadata, optional notes, and local preferences. This remains necessary even though content is processed and stored locally. No article data is transmitted to the developer or third parties by the extension. Exports are initiated by the user. Match the dashboard's exact checkbox labels to these facts and to [the privacy policy](PRIVACY.md).

## Reviewer test instructions

No account or credentials are required. Open a public article page with visible body text, click the extension, and inspect the preview. Use **Export Markdown** to download a file without creating a queue record. Reopen the extension and choose **Save to queue**, then choose **Open queue** to inspect the saved article and export it as Markdown or ZIP. In **Settings**, switch between English and Simplified Chinese and inspect the optional history-retention choices. Chrome internal pages cannot be captured; their popup offers **Open queue**.

## Release checklist

- [x] Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` on the release revision (14 test files, 118 tests passed).
- [ ] In real Chrome, reload the unpacked `dist/` extension and verify capture, direct export, queue persistence, batch ZIP, language switching, and completed history.
- [ ] Export existing local queue records that must survive installing a potentially different Chrome Web Store extension ID.
- [x] Use the current 128×128 PNG icon and two 1280×800 screenshots rendered from the current extension UI with original demo content. A 440×280 promotional tile is also ready.
- [x] Create a ZIP containing the contents of `dist/`, with `manifest.json` at the archive root. The validated archive is `release/open-context-clipper-0.1.0-chrome-web-store.zip` (ignored by Git); source maps and `.DS_Store` files are excluded.
- [x] Confirm the public privacy policy URL is reachable without signing in (HTTP 200).
- [ ] Fill the English listing, privacy practices, distribution, and reviewer instructions in the Developer Dashboard; review the exact submitted fields before submission.
- [ ] Submit for review with deferred publishing if approval should not immediately make the extension public.

Official references: [prepare the package](https://developer.chrome.com/docs/webstore/prepare/), [complete the listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/), [publish](https://developer.chrome.com/docs/webstore/publish/).
