import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const core = await build({
  entryPoints: ["src/core.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  outfile: "dist/notecalc-core.mjs",
  sourcemap: true,
  metafile: true,
});
const worker = await build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  write: false,
  metafile: true,
});
const plugin = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: [
    "obsidian",
    "@codemirror/state",
    "@codemirror/view",
    "node:crypto",
  ],
  outfile: "main.js",
  sourcemap: true,
  metafile: true,
  plugins: [
    {
      name: "notecalc-worker",
      setup(api) {
        api.onResolve({ filter: /^notecalc:worker$/ }, () => ({
          path: "worker",
          namespace: "notecalc-worker",
        }));
        api.onLoad({ filter: /.*/, namespace: "notecalc-worker" }, () => ({
          contents:
            "export default " + JSON.stringify(worker.outputFiles[0].text),
          loader: "js",
        }));
      },
    },
  ],
});
await writeFile('dist/build-inputs.json', JSON.stringify({
  core: core.metafile, worker: worker.metafile, plugin: plugin.metafile
}, null, 2) + '\n');
