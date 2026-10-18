import { describe, expect, it } from "vitest";
import { recordToMarkdown, recordsToJson } from "../../src/queue/export";
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
});
