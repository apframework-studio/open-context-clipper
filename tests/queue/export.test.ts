import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { markdownFilename, recordToMarkdown, recordsToJson, recordsToZip } from "../../src/queue/export";
import type { CaptureRecord } from "../../src/shared/models";

const record: CaptureRecord = {
  schemaVersion: 1,
  id: "capture-1",
  source: {
    originalUrl: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    title: "测试文章",
    author: "测试作者",
  },
  content: {
    markdown: "正文包含远程图片。\n\n![图片](https://cdn.example.com/image.png)",
    wordCount: 12,
    imageUrls: ["https://cdn.example.com/image.png"],
  },
  capture: {
    capturedAt: "2026-09-19T08:00:00.000Z",
    extractor: "readability",
    contentHash: "hash-a",
    warnings: [],
  },
  user: { note: "留作参考" },
  delivery: { status: "queued", attempts: 0 },
};

describe("queue exports", () => {
  it("keeps the page title in a safe Markdown filename", () => {
    expect(markdownFilename("上下文工程：入门/实践")).toBe("上下文工程-入门-实践.md");
    expect(markdownFilename("Article.md")).toBe("Article.md");
    expect(markdownFilename("  ")).toBe("article.md");
  });

  it("exports English metadata while preserving article text and JSON keys", () => {
    const markdown = recordToMarkdown(record, "en");
    expect(markdown).toContain("- Source: https://example.com/article");
    expect(markdown).toContain("- Captured at: 2026-09-19T08:00:00.000Z");
    expect(markdown).toContain("- Author: 测试作者");
    expect(markdown).toContain("- Note: 留作参考");
    expect(markdown).toContain(record.content.markdown);

    const files = unzipSync(recordsToZip([record], "en"));
    const article = strFromU8(files[Object.keys(files).find((path) => path.endsWith(".md"))!]!);
    expect(article).toContain("- Source: https://example.com/article");
    expect(JSON.parse(strFromU8(files["captures.json"]!))[0].source.originalUrl).toBe(record.source.originalUrl);
  });

  it("exports a capture with its source metadata and remote image link intact", () => {
    const markdown = recordToMarkdown(record);

    expect(markdown).toContain("# 测试文章");
    expect(markdown).toContain("来源：https://example.com/article");
    expect(markdown).toContain("采集时间：2026-09-19T08:00:00.000Z");
    expect(markdown).toContain("作者：测试作者");
    expect(markdown).toContain("备注：留作参考");
    expect(markdown).toContain("![图片](https://cdn.example.com/image.png)");
  });

  it("exports records as portable, schema-versioned pretty JSON", () => {
    const json = recordsToJson([record]);

    expect(JSON.parse(json)[0].schemaVersion).toBe(1);
    expect(json).toContain('\n    "schemaVersion": 1');
  });

  it("packages selected articles as separate safe Markdown files plus portable JSON", () => {
    const second: CaptureRecord = {
      ...record,
      id: "capture-2",
      source: { ...record.source, title: "../危险/文章" },
      content: { ...record.content, markdown: "第二篇正文" },
    };

    const files = unzipSync(recordsToZip([record, second]));
    const paths = Object.keys(files).sort();

    expect(paths).toHaveLength(3);
    expect(paths).toContain("captures.json");
    expect(paths.every((path) => path === "captures.json" || (path.startsWith("articles/") && !path.slice(9).includes("/")))).toBe(true);
    expect(paths).toContain("articles/测试文章.md");
    expect(paths.every((path) => !path.includes("capture-"))).toBe(true);
    expect(paths.filter((path) => path.endsWith(".md")).map((path) => strFromU8(files[path]!)).join("\n"))
      .toContain("第二篇正文");
    expect(JSON.parse(strFromU8(files["captures.json"]!)).map((item: CaptureRecord) => item.id))
      .toEqual(["capture-1", "capture-2"]);
  });

  it("keeps both Markdown files when two ZIP entries have the same title", () => {
    const second: CaptureRecord = {
      ...record,
      id: "capture-2",
      content: { ...record.content, markdown: "另一篇正文" },
    };
    const files = unzipSync(recordsToZip([record, second]));

    expect(Object.keys(files)).toContain("articles/测试文章.md");
    expect(Object.keys(files)).toContain("articles/测试文章 (2).md");
    expect(strFromU8(files["articles/测试文章.md"]!)).toContain(record.content.markdown);
    expect(strFromU8(files["articles/测试文章 (2).md"]!)).toContain("另一篇正文");
  });
});
