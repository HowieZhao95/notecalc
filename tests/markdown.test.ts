import { test } from "node:test";
import assert from "node:assert/strict";
import { models, evaluate, patchModel } from "../src/engine";
import { calculateMarkdown } from "../src/core";
import { MARKDOWN_EXAMPLE, BLOCK_EXAMPLE, UNIT_EXAMPLE } from "../src/example";
import { CommandService, DocumentAdapter } from "../src/runtime";
const note = (body: string, id = "note-test") =>
  `<!-- notecalc${id ? " id=" + id : ""} -->\n${body}\n<!-- /notecalc -->\n`;
test("普通 Markdown 列表与历史代码块共享量纲和八个收益结果", () => {
  const a = calculateMarkdown(MARKDOWN_EXAMPLE)[0],
    b = calculateMarkdown(UNIT_EXAMPLE)[0];
  assert.equal(a.result.status, "valid");
  assert.equal(a.model.format, "markdown");
  for (const name of [
    "毕业率",
    "每单学生提成",
    "每单结余",
    "总单量",
    "总收入",
    "学生提成合计",
    "词元成本合计",
    "组织方交付结余",
  ])
    assert.equal(a.result.values[name], b.result.values[name]);
  assert.deepEqual(a.model.outputs, ["每单结余", "组织方交付结余"]);
  assert.ok(a.feedback.some((f) => f.text === " → 56,000 元"));
});
test("轻量代码块无需模型标识，统一 = 自动区分字面量与算式", () => {
  const m = models(BLOCK_EXAMPLE)[0],
    r = evaluate(m);
  assert.equal(m.id, "block-1");
  assert.equal(m.identity, "position");
  assert.deepEqual(
    m.nodes.map((n) => n.kind),
    ["input", "input", "formula"],
  );
  assert.equal(r.displayValues.面积, "6 m²");
});
test("普通标题、段落和列表保持原 Markdown；只解析标记区域", () => {
  const source =
    "- 价格：`999 元`\n\n" +
    note(
      "## 输入\n\n这里是说明。\n- 说明文字\n- 单价：`2000 元/单`\n\n## 计算\n- 订单：`80 单`\n- **收入**：`单价 * 订单`",
    ) +
    "\n- 收入：`不能执行`\n";
  const m = models(source)[0];
  assert.deepEqual(
    m.nodes.map((n) => n.name),
    ["单价", "订单", "收入"],
  );
  assert.equal(evaluate(m).displayValues.收入, "160,000 元");
  assert.equal(calculateMarkdown("- a：`1`").length, 0);
});
test("列表源范围准确，CRLF、粗体、多个反引号、说明与另一个模型逐字符保留", () => {
  const src = (
    "标题\n" +
    note(
      "- **单价**：`` 2000 元/单 `` <!-- 保留单价 -->\n- 订单：`80 单`\n- 收入：`单价 * 订单`",
    ) +
    "\n" +
    note("- 单价：`5`", "other")
  ).replace(/\n/g, "\r\n");
  const m = models(src)[0];
  for (const n of m.nodes) {
    assert.equal(src.slice(n.from, n.to), n.expression);
    assert.equal(src.slice(n.nameFrom, n.nameTo), n.name);
  }
  const out = patchModel(src, m, [
    { op: "set_input", name: "单价", literal: "2500 元/单" },
    { op: "rename", name: "单价", newName: "售价" },
  ]);
  const expected = src
    .replace("**单价**", "**售价**")
    .replace("2000 元/单", "2500 元/单")
    .replace("`单价 * 订单`", "`售价 * 订单`");
  assert.equal(out.source, expected);
  assert.equal(evaluate(models(out.source)[0]).values.收入, "200000");
});
test("列表内单位转换、约束转换与公式显示单位共用补丁", () => {
  const src = note(
    "<!-- notecalc:input 长 min=100 max=300 step=50 -->\n- 长：`200 cm`\n- 面积：`长*长`",
  );
  const out = patchModel(src, models(src)[0], [
    { op: "set_unit", name: "长", unit: "m" },
    { op: "set_unit", name: "面积", unit: "cm²" },
  ]);
  assert.ok(out.source.includes("min=1 max=3 step=0.5"));
  assert.ok(out.source.includes('<!-- notecalc:unit 长 "m" -->'));
  const r = evaluate(models(out.source)[0]);
  assert.equal(r.values.长, "2");
  assert.equal(r.displayValues.面积, "40,000 cm²");
});
test("模型缺闭合、列表缺反引号、类型错误都在原行诊断，不提供旧的有效结果", () => {
  for (const src of [
    "<!-- notecalc -->\n- a：`1`",
    note("- a：`1"),
    note("- a：`1 m`\n- b：`2 s`\n- c：`a+b`"),
  ]) {
    const result = calculateMarkdown(src)[0];
    assert.notEqual(result.result.status, "valid");
    assert.equal(Object.hasOwn(result.result.values, "c"), false);
    if (src.includes("2 s")) assert.equal(result.result.values.a, "1");
    else assert.equal(Object.keys(result.result.values).length, 0);
    assert.ok(result.feedback.some((f) => !f.valid && f.detail.includes("行")));
  }
  const r = calculateMarkdown(note("- a：`1 m`\n- b：`2 s`\n- c：`a+b`"))[0];
  assert.equal(r.result.diagnostics.find((d) => d.variable === "c")?.line, 4);
});
test("原有 Markdown 示例围栏内的标记与算式不会执行", () => {
  const src =
    "````markdown\n" + MARKDOWN_EXAMPLE + "\n" + BLOCK_EXAMPLE + "````";
  assert.equal(models(src).length, 0);
  const inner = note("- a：`1`\n```text\n- 影子：`99`\n```\n- b：`a*2`");
  assert.deepEqual(
    models(inner)[0].nodes.map((n) => n.name),
    ["a", "b"],
  );
});
test("多行 HTML 注释和缩进代码中的算式仅作为文档，不执行", () => {
  assert.equal(models("<!--\n" + MARKDOWN_EXAMPLE + "\n-->").length, 0);
  const src = note(
    "- a：`1`\n<!-- 说明\n- 影子：`100`\n-->\n    - 文档例子：`200`\n- b：`a*2`",
  );
  assert.deepEqual(
    models(src)[0].nodes.map((n) => n.name),
    ["a", "b"],
  );
  assert.equal(evaluate(models(src)[0]).values.b, "2");
});
test("多个列表、代码块默认隔离；位置标识在普通说明编辑后保持", () => {
  const src = note("- a：`1`", "") + BLOCK_EXAMPLE;
  const all = models(src);
  assert.deepEqual(
    all.map((m) => m.id),
    ["note-1", "block-2"],
  );
  assert.deepEqual(
    models("新增说明\n\n" + src).map((m) => m.id),
    all.map((m) => m.id),
  );
  assert.equal(
    evaluate(models(note("- b：`a+1`", "other"))[0]).status,
    "error",
  );
});
test("前向引用、函数与复合单位常量也支持统一等号", () => {
  const src =
    "```notecalc\n面积 = 长*宽\n长 = 200 cm\n宽 = 3 m\n距离 = 5 [m/s] * 2 s\n小边 = min(长, 宽)\n```";
  const r = calculateMarkdown(src)[0].result;
  assert.equal(r.displayValues.面积, "6 m²");
  assert.equal(r.displayValues.距离, "10 m");
  assert.equal(r.displayValues.小边, "200 cm");
});
test("自动识别未知单位仍报单位错误，绝不静默当作变量引用", () => {
  const r = calculateMarkdown(note("- 量：`2 火星米`"))[0].result;
  assert.equal(r.diagnostics[0].code, "UNKNOWN_UNIT");
});
test("源修改拒绝反引号和 HTML 标记注入", () => {
  const src = note("- a：`1`\n- b：`a*2`");
  for (const expression of ["a`\n- 偷渡：`1", "a<!-- /notecalc -->", "a`"])
    assert.throws(() =>
      patchModel(src, models(src)[0], [
        { op: "set_formula", name: "b", expression },
      ]),
    );
});
test("两个格式的纯文本反馈不需要宿主或 DOM，计算绝不写派生值", () => {
  const before = MARKDOWN_EXAMPLE;
  const c = calculateMarkdown(before);
  assert.equal(before, MARKDOWN_EXAMPLE);
  assert.ok(
    c[0].feedback.every(
      (f) => typeof f.line === "number" && typeof f.text === "string",
    ),
  );
  assert.ok(!before.includes("56000"));
});
function memory(source: string) {
  let text = source;
  const adapter: DocumentAdapter = {
    vaultId: "test",
    read: async () => ({ source: text, saveStatus: "saved", bufferIds: [] }),
    list: async () => ["NoteCalc/example.md"],
    write: async (_path, expected, next) => {
      assert.equal(text, expected);
      text = next;
      return { applied: true, saveStatus: "saved" };
    },
  };
  const runtime = new CommandService(
    adapter,
    () => "NoteCalc/",
    () => [],
  );
  const target = {
    vaultId: "test",
    path: "NoteCalc/example.md",
    modelId: models(source)[0].id,
  };
  return {
    runtime,
    target,
    get: () => text,
    set: (s: string) => {
      text = s;
      runtime.observe(target.path, s);
    },
  };
}
test("Markdown 模式 Agent 试算不改变正文或编辑视图，批准应用后精确撤回", async () => {
  const s = memory(MARKDOWN_EXAMPLE),
    base = await s.runtime.inspect(s.target);
  s.runtime.views.set("editor", { target: s.target });
  const p = await s.runtime.preview({
    target: s.target,
    sessionId: base.sessionId,
    sourceRevision: base.sourceRevision,
    baseSnapshotId: base.snapshotId,
    changes: [{ op: "set_input", name: "每单单价", literal: "2500 元/单" }],
  });
  assert.equal(s.get(), MARKDOWN_EXAMPLE);
  assert.equal(
    (await s.runtime.inspect(s.target, { viewId: "editor" })).snapshotId,
    base.snapshotId,
  );
  assert.equal(p.snapshot.displayValues.组织方交付结余, "76,000 元");
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  const receipt = await s.runtime.commit({ ...p, requestId: "md-apply" });
  assert.equal(s.get(), MARKDOWN_EXAMPLE.replace("2000 元/单", "2500 元/单"));
  const inverse = await s.runtime.retractPreview(receipt.receiptId);
  s.runtime.approveFromUI(inverse.previewId, inverse.previewDigest);
  await s.runtime.commit({ ...inverse, requestId: "md-reverse" });
  assert.equal(s.get(), MARKDOWN_EXAMPLE);
});
test("人直接编辑 Markdown 后自动重算，Agent 的旧候选不能覆盖", async () => {
  const s = memory(MARKDOWN_EXAMPLE),
    base = await s.runtime.inspect(s.target),
    p = await s.runtime.preview({
      target: s.target,
      sessionId: base.sessionId,
      sourceRevision: base.sourceRevision,
      baseSnapshotId: base.snapshotId,
      changes: [{ op: "rename", name: "每单单价", newName: "售价" }],
    });
  s.set(MARKDOWN_EXAMPLE.replace("2000 元/单", "2500 元/单"));
  const current = await s.runtime.inspectLocal(s.target);
  assert.equal(current.values.组织方交付结余, "76000");
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  await assert.rejects(s.runtime.commit({ ...p, requestId: "old" }), {
    code: "STALE",
  });
  assert.ok(s.get().includes("2500 元/单"));
});
test("人可计算本地其他目录，Agent 范围与视图发现仍实际受限", async () => {
  const s = memory(MARKDOWN_EXAMPLE),
    outside = { ...s.target, path: "Private/test.md" };
  const local = await s.runtime.inspectLocal(outside);
  assert.equal(local.status, "valid");
  s.runtime.views.set("private-editor", { target: outside });
  assert.equal(s.runtime.capabilities().views.length, 0);
  await assert.rejects(s.runtime.inspect(outside), { code: "SCOPE" });
});
test("列表模型的名称单位应用和反向恢复保持粗体与注释", async () => {
  const original = note("- **长**：`200 cm` <!-- 留存 -->\n- 双倍：`长*2`"),
    s = memory(original),
    b = await s.runtime.inspect(s.target),
    p = await s.runtime.preview({
      target: s.target,
      sessionId: b.sessionId,
      sourceRevision: b.sourceRevision,
      baseSnapshotId: b.snapshotId,
      changes: [
        { op: "rename", name: "长", newName: "长度" },
        { op: "set_unit", name: "长", unit: "m" },
      ],
    });
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  const receipt = await s.runtime.commit({ ...p, requestId: "rename-unit" }),
    r = await s.runtime.retractPreview(receipt.receiptId);
  s.runtime.approveFromUI(r.previewId, r.previewDigest);
  await s.runtime.commit({ ...r, requestId: "back" });
  assert.equal(s.get(), original);
});
