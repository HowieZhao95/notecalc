// Explicit offline mode for files, CI and host integrations; not the live CLI.
import fs from "node:fs";
import { calculateMarkdown } from "../dist/notecalc-core.mjs";
const path = process.argv[2];
if (!path) {
  console.error("用法：node tools/calculate.mjs 文件.md（明确离线模式）");
  process.exit(2);
}
const source = fs.readFileSync(path, "utf8"),
  calculations = calculateMarkdown(source);
console.log(
  JSON.stringify(
    { mode: "offline-file", sharedRuntime: false, calculations },
    null,
    2,
  ),
);
if (calculations.some((c) => c.result.status !== "valid")) process.exitCode = 1;
