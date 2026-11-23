# Open Context Clipper Privacy Policy

Language: **English** · [简体中文](PRIVACY.zh-CN.md)

Last updated: 2026-11-23

Open Context Clipper helps you extract an article from the page you are viewing, save it in a local queue if you choose, and export it as Markdown, JSON, or a ZIP file. The extension does not require an account or send article content to a developer-operated server.

## Data the extension handles

When you click the extension on a web page, it reads the article content already rendered in the active tab. It may process the page URL, title, author, publication date, text, and image URLs to build a preview and Markdown output. It also handles notes you enter, capture timestamps, and your language and history-retention preferences. A page can contain personal information; the extension treats that information as part of the page content you chose to capture.

The extension does not read or store cookies, passwords, login credentials, or your browsing history. It does not run a background collection service or bypass sign-in and paywalls.

## Where data goes

Article extraction and Markdown conversion happen in your browser. Closing the preview does not save a capture. Selecting **Export Markdown** in the preview starts a local file download without adding the article to the queue. Selecting **Save to queue** stores the capture and any note in the extension's local IndexedDB database. Language and retention preferences are stored in Chrome's local extension storage. The extension does not sync these records to a cloud service or transmit them to Open Context Forge, ApFramework Studio, analytics providers, or advertisers.

Exports happen only when you request them. Exported Markdown can contain links to images hosted by the source website; the extension does not download those images. Opening an exported file in another application may cause that application to request linked images from their original hosts.

## Retention and your control

You can search, export, edit notes, and delete saved captures in the queue. Inbox captures remain until you delete or export them. Completed captures are kept indefinitely by default. You may select a 30-day or 90-day history period in Settings; eligible completed records are removed when you next open the queue. Re-exporting resets that period. Deletion cannot be undone in the extension.

The queue is tied to the extension installation and is not backed up by the developer. Removing the extension or installing a copy with a different extension ID can make locally saved captures unavailable. Export any records you want to keep before changing installations.

## Permissions

- `activeTab` grants temporary access to the page you actively choose to capture.
- `scripting` runs the packaged article extractor in that active tab after you click the extension.
- `storage` saves your interface language and retention preferences locally.

Data obtained through Chrome APIs is used only to provide the user-facing article capture, local management, and export features described here. This use follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Contact

For privacy questions or requests about this extension, open an issue at [Open Context Clipper Issues](https://github.com/apframework-studio/open-context-clipper/issues). No account is needed to use the extension, but GitHub may require an account to open an issue.
