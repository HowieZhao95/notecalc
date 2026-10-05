import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CommandService,
  DocumentAdapter,
  Document,
  Grant,
  Target,
} from "../src/runtime";
import { EXAMPLE } from "../src/example";
import { Patch, CalcError, evaluate } from "../src/engine";
class Memory implements DocumentAdapter {
  vaultId = "vault-test";
  source = EXAMPLE;
  saveStatus: Document["saveStatus"] = "saved";
  writes = 0;
  fail = false;
  ambiguity = false;
  async read() {
    if (this.ambiguity) throw new CalcError("AMBIGUOUS_BUFFER", "不同缓冲区");
    return {
      source: this.source,
      saveStatus: this.saveStatus,
      bufferIds: ["editor-one"],
    };
  }
  async list() {
    return ["NoteCalc/model.md", "Private/secret.md"];
  }
  async write(path: string, expected: string, next: string, patches: Patch[]) {
    if (this.source !== expected) throw new CalcError("STALE", "已变化");
    if (this.fail)
      return {
        applied: false,
        saveStatus: "failed" as const,
        error: "模拟保存失败",
      };
    this.source = next;
    this.writes++;
    return { applied: true, saveStatus: this.saveStatus };
  }
}
function setup() {
  const adapter = new Memory(),
    grants: Grant[] = [];
  const runtime = new CommandService(
    adapter,
    () => "NoteCalc/",
    () => grants,
  );
  const target: Target = {
    vaultId: adapter.vaultId,
    path: "NoteCalc/model.md",
    modelId: "training-delivery",
  };
  return { adapter, runtime, target, grants };
}
async function preview(s: ReturnType<typeof setup>, price = "2500") {
  const b = await s.runtime.inspect(s.target);
  return s.runtime.preview({
    target: s.target,
    sessionId: b.sessionId,
    sourceRevision: b.sourceRevision,
    baseSnapshotId: b.snapshotId,
    changes: [{ op: "set_input", name: "每单单价", literal: price }],
  });
}
const req = (p: Awaited<ReturnType<typeof preview>>, id = "req-1") => ({
  sessionId: p.sessionId,
  previewId: p.previewId,
  previewDigest: p.previewDigest,
  requestId: id,
});
test("试算不写入、工具与视图为同一快照", async () => {
  const s = setup(),
    p = await preview(s);
  assert.equal(s.adapter.source, EXAMPLE);
  assert.equal(p.snapshot.values["每单结余"], "950");
  assert.equal(p.snapshot.values["组织方交付结余"], "76000");
  s.runtime.views.set("v", { target: s.target, scenarioId: p.scenarioId });
  const seen = await s.runtime.inspect(s.target, { viewId: "v" });
  assert.equal(seen.snapshotId, p.snapshot.snapshotId);
  assert.equal(seen.values["组织方交付结余"], "76000");
  assert.equal(
    (await s.runtime.inspect(s.target)).values["组织方交付结余"],
    "56000",
  );
  assert.equal(s.adapter.writes, 0);
});
test("三方案共同基准，两个视图互不切换", async () => {
  const s = setup(),
    base = await s.runtime.inspect(s.target),
    ps = [];
  for (const price of ["1500", "2000", "2500"])
    ps.push(await preview(s, price));
  assert.ok(ps.every((p) => p.baseSnapshotId === base.snapshotId));
  assert.deepEqual(
    ps.map((p) => p.snapshot.values["组织方交付结余"]),
    ["36000", "56000", "76000"],
  );
  s.runtime.views.set("v1", { target: s.target, scenarioId: ps[0].scenarioId });
  s.runtime.views.set("v2", { target: s.target, scenarioId: ps[2].scenarioId });
  assert.equal(
    (await s.runtime.inspect(s.target, { viewId: "v1" })).values[
      "组织方交付结余"
    ],
    "36000",
  );
  assert.equal(
    (await s.runtime.inspect(s.target, { viewId: "v2" })).values[
      "组织方交付结余"
    ],
    "76000",
  );
});
test("默认只读且 approved:true 无法获得权限", async () => {
  const s = setup(),
    p = await preview(s);
  await assert.rejects(
    s.runtime.dispatch("commit", { ...req(p), approved: true }),
    { code: "PERMISSION" },
  );
  assert.equal(s.adapter.source, EXAMPLE);
});
test("界面批准摘要，提交幂等、源范围准确、撤回生成反向候选", async () => {
  const s = setup(),
    p = await preview(s);
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  const r = await s.runtime.commit(req(p), "ui");
  assert.equal(r.saveStatus, "saved");
  assert.equal(
    s.adapter.source,
    EXAMPLE.replace("每单单价 = 2000", "每单单价 = 2500"),
  );
  assert.deepEqual(await s.runtime.commit(req(p), "ui"), r);
  assert.equal(s.adapter.writes, 1);
  const reverse = await s.runtime.retractPreview(r.receiptId);
  s.runtime.approveFromUI(reverse.previewId, reverse.previewDigest);
  await s.runtime.commit(req(reverse, "reverse"), "ui");
  assert.equal(s.adapter.source, EXAMPLE);
});
test("陈旧提交和先改后撤销的 ABA 版本拒绝覆盖", async () => {
  const s = setup(),
    p = await preview(s);
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  s.adapter.source = EXAMPLE.replace("2000", "2100");
  s.runtime.observe(s.target.path, s.adapter.source);
  s.adapter.source = EXAMPLE;
  s.runtime.observe(s.target.path, s.adapter.source);
  await assert.rejects(s.runtime.commit(req(p), "ui"), { code: "STALE" });
  assert.equal(s.adapter.writes, 0);
});
test("限定授权仅覆盖指定输入；公式仍需界面批准", async () => {
  const s = setup();
  s.grants.push({
    path: s.target.path,
    modelId: s.target.modelId,
    inputs: ["每单单价"],
  });
  const p = await preview(s);
  await s.runtime.commit(req(p));
  const base = await s.runtime.inspect(s.target);
  const formula = await s.runtime.preview({
    target: s.target,
    sessionId: base.sessionId,
    sourceRevision: base.sourceRevision,
    baseSnapshotId: base.snapshotId,
    changes: [
      { op: "set_formula", name: "每单结余", expression: "每单单价-300" },
    ],
  });
  await assert.rejects(s.runtime.commit(req(formula, "formula")), {
    code: "PERMISSION",
  });
});
test("撤销授权立即阻止已生成候选", async () => {
  const s = setup();
  s.grants.push({
    path: s.target.path,
    modelId: s.target.modelId,
    inputs: ["每单单价"],
  });
  const p = await preview(s);
  s.grants.length = 0;
  await assert.rejects(s.runtime.commit(req(p)), { code: "PERMISSION" });
});
test("会话、Vault、目录、摘要、防修改对象、请求重用", async () => {
  const s = setup(),
    p = await preview(s);
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  await assert.rejects(s.runtime.commit({ ...req(p), sessionId: "old" }), {
    code: "SESSION",
  });
  await assert.rejects(s.runtime.commit({ ...req(p), previewDigest: "fake" }), {
    code: "DIGEST",
  });
  await assert.rejects(s.runtime.inspect({ ...s.target, vaultId: "wrong" }), {
    code: "VAULT",
  });
  await assert.rejects(
    s.runtime.inspect({ ...s.target, path: "Private/secret.md" }),
    { code: "SCOPE" },
  );
  await assert.rejects(
    s.runtime.inspect({ ...s.target, path: "NoteCalc/../x.md" }),
    { code: "PATH" },
  );
  p.changes[0] = { op: "set_input", name: "每单单价", literal: "1500" };
  await s.runtime.commit(req(p), "ui");
  assert.ok(s.adapter.source.includes("每单单价 = 2500"));
  await assert.rejects(
    s.runtime.commit({ ...req(p), previewDigest: "fake" }, "ui"),
    { code: "REQUEST_REUSE" },
  );
});
test("队列中的两个相同基准提交只有一个成功", async () => {
  const s = setup();
  s.grants.push({
    path: s.target.path,
    modelId: s.target.modelId,
    inputs: ["每单单价"],
  });
  const a = await preview(s, "2500"),
    b = await preview(s, "1500");
  const rs = await Promise.allSettled([
    s.runtime.commit(req(a, "a")),
    s.runtime.commit(req(b, "b")),
  ]);
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(s.adapter.writes, 1);
});
test("保存失败不伪报应用成功，未落盘与已落盘分离", async () => {
  const s = setup(),
    p = await preview(s);
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  s.adapter.fail = true;
  await assert.rejects(s.runtime.commit(req(p), "ui"), { code: "SAVE_FAILED" });
  assert.equal(s.adapter.source, EXAMPLE);
  s.adapter.fail = false;
  s.adapter.saveStatus = "unsaved";
  const r = await s.runtime.commit(req(p), "ui");
  assert.equal(r.applied, true);
  assert.equal(r.saveStatus, "unsaved");
  s.adapter.saveStatus = "saved";
  assert.equal((await s.runtime.receiptList())[0].saveStatus, "saved");
});
test("编辑器最新内容优先，并拒绝缓冲歧义", async () => {
  const s = setup();
  s.adapter.source = EXAMPLE.replace("每单单价 = 2000", "每单单价 = 2500");
  s.adapter.saveStatus = "unsaved";
  assert.equal(
    (await s.runtime.inspect(s.target)).values["组织方交付结余"],
    "76000",
  );
  s.adapter.ambiguity = true;
  await assert.rejects(s.runtime.inspect(s.target), {
    code: "AMBIGUOUS_BUFFER",
  });
});
test("已丢弃候选无法提交，解释来源使用指定快照", async () => {
  const s = setup(),
    p = await preview(s);
  const explain = await s.runtime.explain(s.target, "每单结余", {
    scenarioId: p.scenarioId,
  });
  assert.equal(explain.snapshotId, p.snapshot.snapshotId);
  assert.equal(explain.value, "950");
  assert.ok(
    explain.dependencies.some(
      (d) => d.name === "每单单价" && d.value === "2500",
    ),
  );
  s.runtime.discard(p.previewId);
  await assert.rejects(s.runtime.commit(req(p)), { code: "PREVIEW" });
});
test("旧异步计算完成时不能发布陈旧快照", async () => {
  const s = setup();
  let release!: () => void;
  const pause = new Promise<void>((resolve) => (release = resolve));
  const runtime = new CommandService(
    s.adapter,
    () => "NoteCalc/",
    () => [],
    async (model) => {
      await pause;
      return evaluate(model);
    },
  );
  const pending = runtime.inspect(s.target);
  await new Promise((resolve) => setTimeout(resolve, 10));
  s.adapter.source = EXAMPLE.replace("每单单价 = 2000", "每单单价 = 2500");
  runtime.observe(s.target.path, s.adapter.source);
  release();
  await assert.rejects(pending, { code: "STALE" });
});
test("并行读取同一源版本共用一个不可变快照", async () => {
  const s = setup();
  const snapshots = await Promise.all([
    s.runtime.inspect(s.target),
    s.runtime.inspect(s.target),
  ]);
  assert.equal(snapshots[0].snapshotId, snapshots[1].snapshotId);
});
test("提交校验期间撤销权限必须阻止最终写入", async () => {
  const s = setup();
  let gate = false;
  let release!: () => void;
  const pause = new Promise<void>((resolve) => (release = resolve));
  const runtime = new CommandService(
    s.adapter,
    () => "NoteCalc/",
    () => s.grants,
    async (model) => {
      if (gate) await pause;
      return evaluate(model);
    },
  );
  s.runtime = runtime;
  s.grants.push({
    path: s.target.path,
    modelId: s.target.modelId,
    inputs: ["每单单价"],
  });
  const p = await preview(s);
  gate = true;
  const pending = runtime.commit(req(p));
  await new Promise((resolve) => setTimeout(resolve, 10));
  s.grants.length = 0;
  release();
  await assert.rejects(pending, { code: "PERMISSION" });
  assert.equal(s.adapter.writes, 0);
});
test("视图无效草稿必须标记旧结果过期，不能当作当前来源", async () => {
  const s = setup(),
    p = await preview(s);
  s.runtime.views.set("v", {
    target: s.target,
    scenarioId: p.scenarioId,
    draft: { status: "error", message: "步长错误" },
  });
  const r = await s.runtime.inspect(s.target, { viewId: "v" });
  assert.equal(r.viewState?.resultsCurrent, false);
  assert.equal(r.viewState?.calculationStatus, "error");
  await assert.rejects(
    s.runtime.explain(s.target, "每单结余", { viewId: "v" }),
    { code: "STALE" },
  );
  assert.equal(
    (await s.runtime.inspect(s.target)).values["组织方交付结余"],
    "56000",
  );
});

test("改名与单位共享视图，限定数值授权不能写入，界面应用后可撤回", async () => {
  const s = setup();
  s.adapter.source = EXAMPLE.replace("每单单价 = 2000", "每单单价 = 2000 元/单")
    .replace("每单词元成本 = 300", "每单词元成本 = 300 元/单")
    .replace("总单量 := 毕业人数 * 变现月数 * 每人每月单量", "总单量 := 80 单");
  const original = s.adapter.source;
  s.grants.push({
    path: s.target.path,
    modelId: s.target.modelId,
    inputs: ["每单单价"],
  });
  const base = await s.runtime.inspect(s.target);
  const p = await s.runtime.preview({
    target: s.target,
    sessionId: base.sessionId,
    sourceRevision: base.sourceRevision,
    baseSnapshotId: base.snapshotId,
    changes: [
      { op: "rename", name: "每单单价", newName: "售价" },
      { op: "set_unit", name: "每单单价", unit: "元/单" },
    ],
  });
  assert.equal(s.adapter.source, original);
  s.runtime.views.set("metadata-view", {
    target: s.target,
    scenarioId: p.scenarioId,
  });
  const view = await s.runtime.inspect(s.target, { viewId: "metadata-view" });
  assert.equal(view.snapshotId, p.snapshot.snapshotId);
  assert.equal(view.model.units.售价, "元/单");
  assert.equal(view.values["每单结余"], "700");
  await assert.rejects(s.runtime.commit(req(p, "metadata-agent")), {
    code: "PERMISSION",
  });
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  const receipt = await s.runtime.commit(req(p, "metadata-ui"), "ui");
  assert.ok(s.adapter.source.includes("售价 = 2000"));
  const reverse = await s.runtime.retractPreview(receipt.receiptId);
  s.runtime.approveFromUI(reverse.previewId, reverse.previewDigest);
  await s.runtime.commit(req(reverse, "metadata-reverse"), "ui");
  assert.equal(s.adapter.source, original);
});
test("改名候选遇到源变更仍拒绝陈旧提交", async () => {
  const s = setup(),
    base = await s.runtime.inspect(s.target);
  const p = await s.runtime.preview({
    target: s.target,
    sessionId: base.sessionId,
    sourceRevision: base.sourceRevision,
    baseSnapshotId: base.snapshotId,
    changes: [{ op: "rename", name: "每单结余", newName: "交付结余" }],
  });
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  s.adapter.source = EXAMPLE.replace("2000", "2500");
  await assert.rejects(s.runtime.commit(req(p)), { code: "STALE" });
  assert.ok(s.adapter.source.includes("2000") === false);
});

test("显示单位转换、控件转换、应用与反向恢复共用一个事务", async () => {
  const s = setup();
  s.adapter.source =
    "```notecalc\n// @model training-delivery\n// @input 长 control=slider min=100 max=300 step=50\n// @unit 长 cm\n长 = 200\n两倍 := 长*2\n```\n";
  const original = s.adapter.source,
    base = await s.runtime.inspect(s.target);
  const p = await s.runtime.preview({
    target: s.target,
    sessionId: base.sessionId,
    sourceRevision: base.sourceRevision,
    baseSnapshotId: base.snapshotId,
    changes: [{ op: "set_unit", name: "长", unit: "m" }],
  });
  assert.equal(p.snapshot.values.长, "2");
  assert.equal(p.snapshot.inputs.长, "2");
  assert.equal(s.adapter.source, original);
  s.runtime.approveFromUI(p.previewId, p.previewDigest);
  const receipt = await s.runtime.commit(req(p, "convert"), "ui");
  const reverse = await s.runtime.retractPreview(receipt.receiptId);
  s.runtime.approveFromUI(reverse.previewId, reverse.previewDigest);
  await s.runtime.commit(req(reverse, "convert-reverse"), "ui");
  assert.equal(s.adapter.source, original);
});
test("限定数值授权不能通过带单位的literal改变变量类型", async () => {
  const s = setup();
  s.adapter.source =
    "```notecalc\n// @model training-delivery\na = 2\nb := a*2\n```";
  s.grants.push({
    path: s.target.path,
    modelId: s.target.modelId,
    inputs: ["a"],
  });
  const b = await s.runtime.inspect(s.target),
    p = await s.runtime.preview({
      target: s.target,
      sessionId: b.sessionId,
      sourceRevision: b.sourceRevision,
      baseSnapshotId: b.snapshotId,
      changes: [{ op: "set_input", name: "a", literal: "2 m" }],
    });
  await assert.rejects(s.runtime.commit(req(p)), { code: "PERMISSION" });
  assert.equal(s.adapter.writes, 0);
});
test("工具候选拒绝类型错误，返回变量、行号和类型细节", async () => {
  const s = setup();
  s.adapter.source =
    "```notecalc\n// @model training-delivery\na = 1 m\nb = 1 m\nc := a+b\n```";
  const b = await s.runtime.inspect(s.target);
  await assert.rejects(
    s.runtime.preview({
      target: s.target,
      sessionId: b.sessionId,
      sourceRevision: b.sourceRevision,
      baseSnapshotId: b.snapshotId,
      changes: [{ op: "set_input", name: "b", literal: "1 s" }],
    }),
    (e) =>
      e instanceof CalcError &&
      e.code === "INVALID_MODEL" &&
      !!e.details?.diagnostics &&
      e.message.includes("时间"),
  );
});
