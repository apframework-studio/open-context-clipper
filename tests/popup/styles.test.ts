import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  fileURLToPath(new URL("../../src/popup/styles.css", import.meta.url)),
  "utf8",
);

function hasBalancedBlocks(source: string): boolean {
  let depth = 0;
  for (const character of source) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe("popup stylesheet", () => {
  it("keeps CSS rule blocks balanced", () => {
    expect(hasBalancedBlocks(stylesheet)).toBe(true);
  });

  it("uses a stable popup width instead of constraining itself by its own viewport", () => {
    expect(stylesheet).toContain("width: 540px;");
    expect(stylesheet).not.toContain("max-width: calc(100vw");
  });
});
