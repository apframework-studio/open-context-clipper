import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractCaptureFromDocument } from "../../src/extraction/article-extractor";
import { extractMetadata } from "../../src/extraction/metadata";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "..", "fixtures", name), "utf8");

const documentFrom = (name: string, url = "https://example.com/post?utm_source=newsletter") =>
  new JSDOM(fixture(name), { url }).window.document;

describe("extractCaptureFromDocument", () => {
  it("removes consecutive inline, blob and missing-source images while retaining remote images", async () => {
    const document = new JSDOM(`<article><p>${"A useful article paragraph. ".repeat(30)}</p>
      <img src="data:image/png;base64,one" alt="inline-one"><img src="data:image/png;base64,two" alt="inline-two">
      <img src="blob:https://example.com/one" alt="blob-one"><img src="blob:https://example.com/two" alt="blob-two">
      <img alt="missing-source"><img src="" alt="empty-source">
      <img src="/remote.png" alt="remote"><img src="https://cdn.example.com/other.png" alt="other">
      </article>`, { url: "https://example.com/article" }).window.document;

    const result = await extractCaptureFromDocument(document, "https://example.com/article");

    expect(result.content.markdown).not.toMatch(/data:|blob:|missing-source|empty-source/);
    expect(result.content.markdown).toContain("![remote](https://example.com/remote.png)");
    expect(result.content.markdown).toContain("![other](https://cdn.example.com/other.png)");
    expect(result.content.imageUrls).toEqual(["https://example.com/remote.png", "https://cdn.example.com/other.png"]);
  });

  it.each(["<body></body>", "<article><p>   </p></article>", '<article><img src="data:image/png;base64,abc"></article>'])(
    "rejects pages with no Markdown body: %s", async (html) => {
      const document = new JSDOM(html, { url: "https://example.com/empty" }).window.document;
      await expect(extractCaptureFromDocument(document, "https://example.com/empty")).rejects.toThrow(/未能识别.*正文/);
    },
  );

  it.each(["This story is for members only", "Subscribe to read the full story"])(
    "warns about a paywall even when its visible preview is long: %s", async (marker) => {
      const document = new JSDOM(`<article><p>${"This is the visible article preview. ".repeat(30)}</p><p>${marker}</p></article>`,
        { url: "https://medium.com/story" }).window.document;
      const result = await extractCaptureFromDocument(document, "https://medium.com/story");

      expect(result.content.markdown).toContain("visible article preview");
      expect(result.capture.warnings).not.toContain("content_too_short");
      expect(result.capture.warnings).toContain("paywall_preview");
    },
  );

  it("resolves language in JSON-LD, OpenGraph, meta and html priority order", () => {
    const document = documentFrom("metadata-language.html");
    const metadata = extractMetadata(document, "https://example.com/language");

    expect(metadata.language).toBe("zh-Hans");
    document.querySelector('script[type="application/ld+json"]')?.remove();
    expect(extractMetadata(document, "https://example.com/language").language).toBe("zh-CN");
    document.querySelector('meta[property="og:locale"]')?.remove();
    expect(extractMetadata(document, "https://example.com/language").language).toBe("fr");
    document.querySelector('meta[name="language"]')?.remove();
    document.documentElement.lang = "en-GB";
    expect(extractMetadata(document, "https://example.com/language").language).toBe("en-GB");
  });

  it("extracts canonical metadata and absolute GFM Markdown from the rendered document", async () => {
    const result = await extractCaptureFromDocument(documentFrom("generic-article.html"), "https://example.com/post?utm_source=newsletter");

    expect(result.source.canonicalUrl).toBe("https://example.com/canonical-post");
    expect(result.source.title).toBe("JSON-LD 标题");
    expect(result.source.author).toBe("张三");
    expect(result.content.markdown).toContain("[相关链接](https://example.com/docs)");
    expect(result.content.markdown).toContain("![架构图](https://cdn.example.com/diagram.png)");
    expect(result.content.markdown).not.toContain("data:image/png;base64,abc");
    expect(result.content.markdown).toContain("```ts");
    expect(result.content.markdown).toContain("| 阶段 | 结果 |");
    expect(result.content.imageUrls).toEqual(["https://cdn.example.com/diagram.png"]);
    expect(result.capture.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the rendered Medium article as a site-adapter fallback with author and responsive image", async () => {
    const result = await extractCaptureFromDocument(
      documentFrom("medium-article.html", "https://medium.example.com/@author/rendered-story"),
      "https://medium.example.com/@author/rendered-story"
    );

    expect(result.source.canonicalUrl).toBe("https://medium.example.com/@author/rendered-story");
    expect(result.source.author).toBe("Medium Author");
    expect(result.content.markdown).toContain("![Rendered illustration](https://images.example.com/large.png)");
    expect(result.content.markdown).toContain("[follow-up story](https://medium.example.com/follow-up)");
    expect(result.capture.extractor).toBe("site-adapter");
  });

  it("warns when the visible page has too little readable content", async () => {
    const result = await extractCaptureFromDocument(documentFrom("short-page.html"), "https://example.com/login");

    expect(result.capture.warnings).toContain("content_too_short");
    expect(result.content.wordCount).toBeLessThan(200);
  });
});
