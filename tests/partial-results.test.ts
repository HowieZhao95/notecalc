import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateMarkdown, evaluate, models } from "../src/core";
import { CommandService, DocumentAdapter } from "../src/runtime";

const block = (body: string) =>
  "```notecalc\n// @model partial\n" + body + "\n```";
const run = (body: string) => calculateMarkdown(block(body))[0];

test("单行除零仅阻断其依赖链，前向引用的独立结果继续显示", () => {
  const { result, feedback } = run(
    "正常 = 单价 * 数量\n单价 = 2000 元/单\n数量 = 80 单\n错误 = 1 / 0\n受影响 = 错误 * 2\n后续 = 受影响 + 1\n另一结果 = 正常 / 2",
  );
  assert.equal(result.status, "error");
  assert.equal(result.displayValues.正常, "160,000 元");
  assert.equal(result.displayValues.另一结果, "80,000 元");
  assert.equal(result.nodeStates.错误, "error");
  assert.equal(result.nodeStates.受影响, "blocked");
  assert.equal(result.nodeStates.后续, "blocked");
  for (const name of ["错误", "受影响", "后续"])
    assert.equal(Object.hasOwn(result.values, name), false);
  assert.deepEqual(
    feedback.filter((f) => f.valid).map((f) => f.name),
    ["正常", "另一结果"],
  );
  assert.deepEqual(
    feedback.filter((f) => !f.valid).map((f) => f.name),
    ["错误", "受影响", "后续"],
  );
  assert.equal(
    result.diagnostics.filter((d) => d.code === "DIV_ZERO").length,
    1,
  );
});

test("局部类型错误保留正确量纲及不相关公式", () => {
  const { result } = run(
    "长 = 1 m\n时长 = 2 s\n错误 = 长 + 时长\n后续 = 错误 * 2\n距离 = 长 * 3",
  );
  assert.equal(result.displayValues.距离, "3 m");
  assert.equal(result.values.长, "1");
  assert.equal(result.nodeStates.后续, "blocked");
  assert.ok(
    result.diagnostics.some(
      (d) => d.variable === "错误" && d.code === "DIMENSION_MISMATCH",
    ),
  );
});

test("输入未完成时不提供旧值，无关结果保持当前有效值", () => {
  const { result, feedback } = run("a = 2 *\nb = a + 1\nc = 10 + 5");
  assert.equal(result.status, "incomplete");
  assert.equal(result.nodeStates.a, "incomplete");
  assert.equal(result.nodeStates.b, "blocked");
  assert.equal(result.values.c, "15");
  assert.equal(Object.hasOwn(result.values, "a"), false);
  assert.ok(feedback.some((f) => f.name === "c" && f.valid));
});

test("Markdown 未闭合行内代码只影响该名称及引用它的行", () => {
  const source =
    "<!-- notecalc id=partial -->\n- 坏：`2\n- 相关：`坏 * 2`\n- 独立：`3 + 4`\n<!-- /notecalc -->";
  const { result, feedback } = calculateMarkdown(source)[0];
  assert.equal(result.values.独立, "7");
  assert.equal(result.nodeStates.相关, "blocked");
  assert.ok(feedback.some((f) => f.name === "坏" && f.line === 2 && !f.valid));
  assert.ok(
    feedback.some((f) => f.name === "相关" && f.line === 3 && !f.valid),
  );
});

test("循环中各行明确报循环，外部依赖报受影响，无关公式继续求值", () => {
  const { result } = run("前置 = a + 1\na = b + 1\nb = a + 1\n独立 = 2 * 3");
  assert.deepEqual(
    result.diagnostics
      .filter((d) => d.code === "CYCLE")
      .map((d) => d.variable)
      .sort(),
    ["a", "b"],
  );
  assert.equal(result.nodeStates.前置, "blocked");
  assert.equal(result.values.独立, "6");
});

test("重复名称两处均报错，其依赖无结果，但其他定义不受影响", () => {
  const { result, feedback } = run("a = 1\na = 2\nb = a * 2\nc = 3 + 4");
  assert.equal(result.values.c, "7");
  assert.equal(Object.hasOwn(result.values, "a"), false);
  assert.equal(result.nodeStates.b, "blocked");
  assert.deepEqual(
    feedback.filter((f) => f.name === "a").map((f) => f.line),
    [3, 4],
  );
});

test("越界输入和未知单位不会偷偷参与计算", () => {
  const { result } = run(
    "// @input a min=1 max=3\na = 4\nb = a * 2\n坏单位 = 1 火星米\n相关 = 坏单位 + 1\n独立 = 8 * 2",
  );
  assert.equal(result.values.独立, "16");
  for (const name of ["a", "b", "坏单位", "相关"])
    assert.equal(Object.hasOwn(result.quantities, name), false);
});

test("有效缓存遇到局部错误不复用旧错误行，修复后整条依赖链恢复", () => {
  const original = models(block("a = 2\nb = 10 / a\nc = b * 2\nd = 4 + 5"))[0];
  const previous = { model: original, ...evaluate(original) };
  const broken = models(block("a = 0\nb = 10 / a\nc = b * 2\nd = 4 + 5"))[0];
  const partial = evaluate(broken, previous);
  assert.equal(partial.values.d, "9");
  assert.equal(Object.hasOwn(partial.values, "b"), false);
  assert.equal(Object.hasOwn(partial.values, "c"), false);
  const restored = evaluate(
    models(block("a = 2\nb = 10 / a\nc = b * 2\nd = 4 + 5"))[0],
    { model: broken, ...partial },
  );
  assert.equal(restored.status, "valid");
  assert.equal(restored.values.c, "10");
});

test("坏单位元信息仅使指定变量及依赖失效", () => {
  const { result } = run('// @unit a "\na = 1\nb = a * 2\nc = 3 + 4');
  assert.equal(result.values.c, "7");
  assert.equal(Object.hasOwn(result.values, "a"), false);
  assert.equal(result.nodeStates.b, "blocked");
});

test("未知输出标记仍诊断，但不会清空已计算的有效行", () => {
  const { result } = run("// @output missing\na = 2\nb = a * 3");
  assert.equal(result.status, "error");
  assert.equal(result.values.b, "6");
});

test("错误模型可以解释有效行，错误行不能解释为有效值，也不能提交不完整候选", async () => {
  const source = block("坏 = 1 / 0\n相关 = 坏 * 2\n独立 = 2 * 3");
  const adapter: DocumentAdapter = {
    vaultId: "test",
    read: async () => ({ source, saveStatus: "saved", bufferIds: [] }),
    list: async () => [],
    write: async () => {
      throw new Error("不可写入");
    },
  };
  const runtime = new CommandService(
    adapter,
    () => "NoteCalc/",
    () => [],
  );
  const target = {
    vaultId: "test",
    path: "NoteCalc/partial.md",
    modelId: "partial",
  };
  const snapshot = await runtime.inspect(target);
  runtime.views.set("editor", {
    target,
    draft: { status: "error", sourceRevision: snapshot.sourceRevision },
  });
  const shared = await runtime.inspect(target, { viewId: "editor" });
  assert.equal(shared.viewState?.resultsCurrent, true);
  assert.equal(
    (await runtime.explain(target, "独立", { viewId: "editor" })).value,
    "6",
  );
  await assert.rejects(runtime.explain(target, "相关"), {
    code: "INVALID_MODEL",
  });
  await assert.rejects(
    runtime.preview({
      target,
      sessionId: snapshot.sessionId,
      sourceRevision: snapshot.sourceRevision,
      baseSnapshotId: snapshot.snapshotId,
      changes: [{ op: "set_formula", name: "独立", expression: "2*4" }],
    }),
    { code: "INVALID_BASE" },
  );
});
