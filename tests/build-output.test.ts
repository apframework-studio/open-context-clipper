import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const extensionRoot = resolve(import.meta.dirname, "..");
const dist = resolve(extensionRoot, "dist");

beforeAll(() => {
  rmSync(dist, { recursive: true, force: true });
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: extensionRoot,
    stdio: "pipe"
  });
});

function readPngDimensions(file: string): { width: number; height: number } {
  const png = readFileSync(resolve(dist, file));
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}

describe("extension build", () => {
  it("emits a loadable MV3 manifest and every declared entrypoint", () => {
    expect(existsSync(resolve(dist, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Open Context Clipper");
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.action.default_popup).toBe("popup.html");
    for (const file of ["background.js", "content.js", "popup.html", "popup.js", "queue.html", "queue.js"]) {
      expect(existsSync(resolve(dist, file))).toBe(true);
    }
  });

  it("loads the queue stylesheet from its built page", () => {
    const queueHtml = readFileSync(resolve(dist, "queue.html"), "utf8");

    expect(queueHtml).toContain('rel="stylesheet" href="/queue.css"');
    expect(queueHtml).toContain("<title>Open Context Clipper · 采集队列</title>");
  });

  it("emits branded extension icons at every declared Chrome size", () => {
    const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
    const expectedIcons = {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    };

    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action.default_icon).toEqual(expectedIcons);

    for (const [size, file] of Object.entries(expectedIcons)) {
      expect(existsSync(resolve(dist, file))).toBe(true);
      expect(readPngDimensions(file)).toEqual({ width: Number(size), height: Number(size) });
    }
  });
});
