import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/shared/hash";

describe("sha256Hex", () => {
  it("returns a lowercase SHA-256 digest", async () => {
    await expect(sha256Hex("文章\n\n正文")).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes line endings and surrounding whitespace before hashing", async () => {
    await expect(sha256Hex("  文章\r\n\r\n正文  ")).resolves.toBe(
      await sha256Hex("文章\n\n正文"),
    );
  });
});
