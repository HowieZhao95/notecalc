import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import {
  calculateMarkdown,
  evaluate,
  models,
  inputQuantity,
  unitCapabilities,
  parseUnit,
} from "../src/core";
import { CommandService, DocumentAdapter } from "../src/runtime";

test("一万个未闭合反引号在隔离线程内及时诊断，解析不再回溯卡死", async () => {
  const core = new URL("../dist/notecalc-core.mjs", import.meta.url).href;
  const code = `const {parentPort} = require('node:worker_threads');
    import(${JSON.stringify(core)}).then(({calculateMarkdown}) => {
      const source = '<!-- notecalc -->\\n- a：' + '\x60'.repeat(10000) + 'bad\\n<!-- /notecalc -->';
      parentPort.postMessage(calculateMarkdown(source)[0].result.diagnostics[0].code);
    });`;
  const worker = new Worker(code, { eval: true }); // Test harness only; no note text is executed.
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("解析超过 2 秒")), 2000);
      worker.once("message", (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.equal(code, "LIMIT");
  } finally {
    await worker.terminate();
  }
});

test("单个分隔符和超长未闭合正文明确诊断", () => {
  const source =
    "<!-- notecalc -->\n- a：`" + "x".repeat(100_000) + "\n<!-- /notecalc -->";
  assert.equal(
    calculateMarkdown(source)[0].result.diagnostics[0].code,
    "INCOMPLETE",
  );
  assert.equal(
    calculateMarkdown("<!-- notecalc -->\n- a：`1` junk\n<!-- /notecalc -->")[0]
      .result.status,
    "error",
  );
});

const specialNames =
  "<!-- notecalc id=names -->\n- constructor：`2`\n- __proto__：`3`\n- toString：`4`\n- 总：`constructor + __proto__ + toString`\n<!-- /notecalc -->";
test("特殊名称在直接计算、Worker 克隆和 JSON 往返后结果一致", () => {
  const model = models(specialNames)[0];
  for (const value of [
    model,
    structuredClone(model),
    JSON.parse(JSON.stringify(model)),
  ]) {
    const result = evaluate(value);
    assert.equal(result.status, "valid");
    assert.equal(result.values.总, "9");
    assert.equal(result.values.__proto__, "3");
  }
  assert.equal(({} as any).polluted, undefined);
});

test("Agent 读取克隆后修改特殊名称仍正确且没有批准不能写入", async () => {
  let source = specialNames;
  const adapter: DocumentAdapter = {
    vaultId: "audit",
    list: async () => ["NoteCalc/names.md"],
    read: async () => ({ source, bufferIds: [], saveStatus: "saved" }),
    write: async (_path, expected, next) => {
      assert.equal(source, expected);
      source = next;
      return { applied: true, saveStatus: "saved" };
    },
  };
  const runtime = new CommandService(
    adapter,
    () => "NoteCalc/",
    () => [],
    async (model) => evaluate(structuredClone(model)),
  );
  const target = {
    vaultId: "audit",
    path: "NoteCalc/names.md",
    modelId: "names",
  };
  const base = await runtime.inspect(target);
  const preview = await runtime.preview({
    target,
    sessionId: base.sessionId,
    sourceRevision: base.sourceRevision,
    baseSnapshotId: base.snapshotId,
    changes: [{ op: "set_input", name: "__proto__", literal: "5" }],
  });
  assert.equal(preview.snapshot.values.总, "11");
  const request = {
    sessionId: preview.sessionId,
    previewId: preview.previewId,
    previewDigest: preview.previewDigest,
    requestId: "special",
  };
  await assert.rejects(runtime.commit(request), { code: "PERMISSION" });
  assert.equal(source, specialNames);
  runtime.approveFromUI(preview.previewId, preview.previewDigest);
  await runtime.commit(request);
  assert.equal(source, specialNames.replace("`3`", "`5`"));
});

test("百分号或千分号后的多余内容不能被输入接口忽略", () => {
  assert.equal(inputQuantity("50%").baseValue, "0.5");
  for (const literal of ["50% junk", "50‰ m", "50% %"])
    assert.throws(() => inputQuantity(literal), { code: "INVALID_LITERAL" });
});

test("调用方修改单位能力描述不会污染内部单位注册表", () => {
  const exported = unitCapabilities().units.find(
    (unit) => unit.symbol === "m",
  )!;
  exported.factor = "100";
  exported.dimension.length = 99;
  assert.equal(parseUnit("m").factor, "1");
  assert.equal(parseUnit("m").dimension.length, 1);
});

test("显式失效清除该文档快照并保留其他文档的缓存", async () => {
  const counts = new Map<string, number>();
  const adapter: DocumentAdapter = {
    vaultId: "audit",
    list: async () => [],
    read: async () => ({
      source: specialNames,
      bufferIds: [],
      saveStatus: "saved",
    }),
    write: async () => {
      throw new Error("不应写入");
    },
  };
  const runtime = new CommandService(
    adapter,
    () => "NoteCalc/",
    () => [],
    async (model) => {
      counts.set("calls", (counts.get("calls") ?? 0) + 1);
      return evaluate(model);
    },
  );
  const first = { vaultId: "audit", path: "NoteCalc/a.md", modelId: "names" };
  const second = { ...first, path: "NoteCalc/b.md" };
  await runtime.inspect(first);
  await runtime.inspect(second);
  runtime.invalidate(first.path);
  await runtime.inspect(second);
  assert.equal(counts.get("calls"), 2);
  await runtime.inspect(first);
  assert.equal(counts.get("calls"), 3);
});
