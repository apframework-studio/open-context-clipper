import { describe, expect, it } from "vitest";
import { createTextPreview } from "../../src/shared/preview";

describe("createTextPreview", () => {
  it("keeps paragraph or sentence boundaries for opening and closing previews", () => {
    expect(createTextPreview("第一段。\n\n第二段。\n\n第三段。", 4, 4)).toEqual({
      opening: "第一段。",
      omittedCharacters: 4,
      closing: "第三段。",
    });
  });

  it("returns collapsed plain text when it fits", () => {
    expect(createTextPreview("# 标题\n\n**正文**  内容", 100, 100)).toEqual({
      opening: "标题 正文 内容",
      omittedCharacters: 0,
      closing: "",
    });
  });

  it("starts closing at the next sentence boundary in continuous Chinese text", () => {
    expect(createTextPreview("前文。中间连续内容。结尾。", 1, 6)).toEqual({
      opening: "前",
      omittedCharacters: 9,
      closing: "结尾。",
    });
  });
});
