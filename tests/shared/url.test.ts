import { describe, expect, it } from "vitest";
import { normalizeComparisonUrl } from "../../src/shared/url";

describe("normalizeComparisonUrl", () => {
  it("removes tracking parameters, fragments, and non-root trailing slashes", () => {
    expect(normalizeComparisonUrl("https://example.com/a/?utm_source=x&ref=mail#part"))
      .toBe("https://example.com/a");
  });

  it("matches tracking parameter names case-insensitively", () => {
    expect(normalizeComparisonUrl("https://example.com/?UTM_campaign=x&FBCLID=abc&keep=yes"))
      .toBe("https://example.com/?keep=yes");
  });
});
