import { cp, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: {
    background: "src/background/service-worker.ts",
    content: "src/content/capture-page.ts",
    popup: "src/popup/main.ts",
    queue: "src/queue/main.ts"
  },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
  sourcemap: true
});

await mkdir("dist", { recursive: true });
await mkdir("dist/icons", { recursive: true });
await Promise.all(
  ["manifest.json", "popup.html", "queue.html"].map((file) => cp(file, `dist/${file}`))
);
await Promise.all(
  [16, 32, 48, 128].map((size) =>
    cp(`icons/icon-${size}.png`, `dist/icons/icon-${size}.png`)
  )
);
