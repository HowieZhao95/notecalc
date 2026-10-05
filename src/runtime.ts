import { createHash, randomUUID } from "node:crypto";
import {
  CalcError,
  models,
  evaluate,
  patchModel,
  Change,
  Patch,
  Model,
  Evaluation,
  POLICY,
  inputQuantity,
} from "./engine";
import { unitCapabilities, sameDimension } from "./units";
import type { EvaluateModel } from "./evaluator";
export type Target = { vaultId: string; path: string; modelId: string };
export type Document = {
  source: string;
  saveStatus: "saved" | "unsaved" | "saving" | "failed";
  bufferIds: string[];
};
export interface DocumentAdapter {
  vaultId: string;
  read(path: string): Promise<Document>;
  list(): Promise<string[]>;
  write(
    path: string,
    expected: string,
    next: string,
    patches: Patch[],
    checkRevision?: () => void,
  ): Promise<{
    applied: boolean;
    saveStatus: Document["saveStatus"];
    error?: string;
  }>;
}
export type Snapshot = Evaluation & {
  snapshotId: string;
  sessionId: string;
  target: Target;
  sourceRevision: string;
  inputs: Record<string, string>;
  model: Model;
  saveStatus: Document["saveStatus"];
  bufferIds: string[];
  scenarioId?: string;
  scenarioRevision?: number;
  viewState?: {
    viewId: string;
    calculationStatus: "valid" | "calculating" | "error";
    resultsCurrent: boolean;
    message?: string;
  };
};
export type Preview = {
  previewId: string;
  previewDigest: string;
  scenarioId: string;
  scenarioRevision: number;
  sessionId: string;
  sourceRevision: string;
  baseSnapshotId: string;
  target: Target;
  changes: Change[];
  patches: Patch[];
  snapshot: Snapshot;
  diff: { name: string; before: string; after: string }[];
  resultDiff: {
    name: string;
    before: string;
    after: string;
    beforeUnit?: string;
    afterUnit?: string;
  }[];
  createdAt: string;
};
type Candidate = {
  preview: Preview;
  before: string;
  after: string;
  consumed: boolean;
};
export type Grant = { path: string; modelId: string; inputs: string[] };
export type Receipt = {
  receiptId: string;
  requestId: string;
  previewId: string;
  target: Target;
  beforeRevision: string;
  afterRevision: string;
  applied: boolean;
  saveStatus: Document["saveStatus"];
  error?: string;
  source: "ui" | "agent";
  createdAt: string;
};
const digest = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export class CommandService {
  readonly sessionId = randomUUID();
  readonly protocolVersion = "2";
  private documents = new Map<
    string,
    { fingerprint: string; generation: number }
  >();
  private snapshots = new Map<string, Snapshot>();
  private candidates = new Map<string, Candidate>();
  private receipts = new Map<string, { digest: string; receipt: Receipt }>();
  private approvals = new Set<string>();
  readonly views = new Map<
    string,
    {
      target: Target;
      scenarioId?: string;
      draft?: {
        status: "calculating" | "error";
        message?: string;
        sourceRevision?: string;
      };
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly adapter: DocumentAdapter,
    readonly scope: () => string,
    readonly grants: () => Grant[],
    private evaluateModel: EvaluateModel = async (model) => evaluate(model),
  ) {}
  checkPath(path: string, enforceScope = true) {
    if (
      typeof path !== "string" ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((p) => p === ".." || p === "." || !p) ||
      !path.endsWith(".md")
    )
      throw new CalcError("PATH", "需要 Vault 内完整 Markdown 路径");
    const scope = this.scope();
    if (
      enforceScope &&
      scope &&
      !path.startsWith(scope.endsWith("/") ? scope : scope + "/")
    )
      throw new CalcError("SCOPE", "目标超出已授权目录");
  }
  checkTarget(target: Target, enforceScope = true) {
    if (!target || target.vaultId !== this.adapter.vaultId)
      throw new CalcError("VAULT", "Vault 标识不匹配");
    this.checkPath(target.path, enforceScope);
    if (typeof target.modelId !== "string")
      throw new CalcError("TARGET", "缺少 modelId");
  }
  observe(path: string, source: string) {
    const fingerprint = digest(source),
      old = this.documents.get(path);
    if (!old || old.fingerprint !== fingerprint)
      this.documents.set(path, {
        fingerprint,
        generation: (old?.generation ?? 0) + 1,
      });
  }
  invalidate(path: string) {
    const old = this.documents.get(path);
    if (old) old.generation++;
    for (const key of this.snapshots.keys())
      if (key.startsWith(path + "\u0000")) this.snapshots.delete(key);
  }
  private currentRevision(path: string) {
    const doc = this.documents.get(path);
    return doc ? `${this.sessionId}:${doc.generation}:${doc.fingerprint}` : "";
  }
  private revision(path: string, source: string) {
    this.observe(path, source);
    return this.currentRevision(path);
  }
  private model(source: string, id: string) {
    const all = models(source);
    const matches = all.filter((m) => m.id === id);
    if (matches.length !== 1)
      throw new CalcError(
        "MODEL",
        matches.length ? "模型标识重复" : "模型不存在",
      );
    return matches[0];
  }
  capabilities() {
    return {
      protocolVersion: this.protocolVersion,
      sessionId: this.sessionId,
      vaultId: this.adapter.vaultId,
      engine: POLICY,
      units: unitCapabilities(),
      document: {
        formats: ["markdown-list", "notecalc-block"],
        assignment: "literal or formula inferred from RHS; := supported",
        defaultAuthoring: "Markdown source",
        positionalIds: "valid only with bound sourceRevision",
        feedback: "passive, never persisted",
      },
      scope: this.scope(),
      views: [...this.views.entries()]
        .filter(([, state]) => {
          try {
            this.checkPath(state.target.path);
            return true;
          } catch {
            return false;
          }
        })
        .map(([viewId, state]) => ({ viewId, ...clone(state) })),
      commands: [
        "capabilities",
        "list_models",
        "inspect",
        "preview",
        "commit",
        "explain",
        "discard",
        "export",
        "receipts",
      ],
      permissions: {
        default: "read-only",
        inputGrants: clone(this.grants()),
        formulaCommits: "UI approval only",
        metadataCommits: "UI approval only",
      },
      limits: {
        documentCharacters: 2_000_000,
        variables: 500,
        expressionCharacters: 4096,
      },
      transport: "Obsidian official CLI",
      offlineFallback: false,
    };
  }
  async listModels() {
    const found = [];
    for (const path of await this.adapter.list()) {
      try {
        this.checkPath(path);
      } catch {
        continue;
      }
      const doc = await this.adapter.read(path);
      for (const m of models(doc.source))
        found.push({
          target: { vaultId: this.adapter.vaultId, path, modelId: m.id },
          diagnostics: m.diagnostics,
        });
    }
    return { sessionId: this.sessionId, models: found };
  }
  async inspect(
    target: Target,
    selection?: { scenarioId?: string; viewId?: string },
  ): Promise<Snapshot> {
    return this.inspectNow(target, selection, true);
  }
  /** Human editor can compute local notes; CLI scope is unchanged. */
  async inspectLocal(target: Target): Promise<Snapshot> {
    return this.inspectNow(target, undefined, false);
  }
  private async inspectNow(
    target: Target,
    selection: { scenarioId?: string; viewId?: string } | undefined,
    enforceScope: boolean,
  ): Promise<Snapshot> {
    this.checkTarget(target, enforceScope);
    let scenarioId = selection?.scenarioId;
    let viewState: Snapshot["viewState"];
    let completedRevision: string | undefined;
    if (selection?.viewId) {
      const view = this.views.get(selection.viewId);
      if (!view || JSON.stringify(view.target) !== JSON.stringify(target))
        throw new CalcError("VIEW", "视图不存在或目标不匹配");
      if (scenarioId && scenarioId !== view.scenarioId)
        throw new CalcError("VIEW", "视图与方案不一致");
      scenarioId = view.scenarioId;
      viewState = {
        viewId: selection.viewId,
        calculationStatus: view.draft?.status ?? "valid",
        resultsCurrent: !view.draft,
        message: view.draft?.message,
      };
      if (view.draft?.status === "error")
        completedRevision = view.draft.sourceRevision;
    }
    const doc = await this.adapter.read(target.path),
      revision = this.revision(target.path, doc.source);
    if (viewState && completedRevision === revision)
      viewState.resultsCurrent = true;
    if (scenarioId) {
      const candidate = [...this.candidates.values()].find(
        (c) => c.preview.scenarioId === scenarioId,
      );
      if (!candidate || candidate.consumed)
        throw new CalcError("SCENARIO", "临时方案不存在");
      if (candidate.preview.sourceRevision !== revision)
        throw new CalcError("STALE", "临时方案基准已变化");
      if (JSON.stringify(candidate.preview.target) !== JSON.stringify(target))
        throw new CalcError("TARGET", "方案目标不匹配");
      return clone({
        ...candidate.preview.snapshot,
        saveStatus: doc.saveStatus,
        bufferIds: doc.bufferIds,
        viewState,
      });
    }
    const key = target.path + "\0" + target.modelId;
    const cached = this.snapshots.get(key);
    if (cached?.sourceRevision === revision)
      return clone({
        ...cached,
        saveStatus: doc.saveStatus,
        bufferIds: doc.bufferIds,
        viewState,
      });
    const model = this.model(doc.source, target.modelId);
    const result = await this.evaluateModel(model, key);
    const latest = await this.adapter.read(target.path);
    if (this.revision(target.path, latest.source) !== revision)
      throw new CalcError("STALE", "计算期间文档已变化，丢弃旧结果");
    const competing = this.snapshots.get(key);
    if (competing?.sourceRevision === revision)
      return clone({
        ...competing,
        saveStatus: latest.saveStatus,
        bufferIds: latest.bufferIds,
        viewState,
      });
    const snapshot: Snapshot = {
      ...result,
      snapshotId: randomUUID(),
      sessionId: this.sessionId,
      target: clone(target),
      sourceRevision: revision,
      inputs: Object.fromEntries(
        model.nodes
          .filter((n) => n.kind === "input")
          .map((n) => [n.name, n.expression]),
      ),
      model,
      saveStatus: latest.saveStatus,
      bufferIds: latest.bufferIds,
    };
    this.snapshots.set(key, snapshot);
    while (this.snapshots.size > 100)
      this.snapshots.delete(this.snapshots.keys().next().value!);
    return clone({ ...snapshot, viewState });
  }
  async preview(request: {
    target: Target;
    sessionId: string;
    sourceRevision: string;
    baseSnapshotId: string;
    changes: Change[];
  }): Promise<Preview> {
    request = clone(request);
    if (request.sessionId !== this.sessionId)
      throw new CalcError("SESSION", "运行时会话已变化");
    const base = await this.inspect(request.target);
    if (
      base.sourceRevision !== request.sourceRevision ||
      base.snapshotId !== request.baseSnapshotId
    )
      throw new CalcError("STALE", "基准版本或快照已变化");
    if (base.status !== "valid")
      throw new CalcError("INVALID_BASE", "基准模型未通过校验");
    const doc = await this.adapter.read(request.target.path);
    if (this.revision(request.target.path, doc.source) !== base.sourceRevision)
      throw new CalcError("STALE", "读取时源文档已变化");
    const changed = patchModel(doc.source, base.model, request.changes, false);
    const model = this.model(changed.source, request.target.modelId);
    const previewId = randomUUID(),
      scenarioId = randomUUID();
    const result = await this.evaluateModel(model, undefined, base);
    if (
      this.revision(
        request.target.path,
        (await this.adapter.read(request.target.path)).source,
      ) !== base.sourceRevision
    )
      throw new CalcError("STALE", "试算期间文档已变化");
    if (result.status !== "valid")
      throw new CalcError(
        "INVALID_MODEL",
        result.diagnostics.map((d) => d.message).join("；"),
        undefined,
        { diagnostics: result.diagnostics },
      );
    const snapshot: Snapshot = {
      ...result,
      snapshotId: randomUUID(),
      sessionId: this.sessionId,
      target: clone(request.target),
      sourceRevision: base.sourceRevision,
      inputs: Object.fromEntries(
        model.nodes
          .filter((n) => n.kind === "input")
          .map((n) => [n.name, n.expression]),
      ),
      model,
      saveStatus: doc.saveStatus,
      bufferIds: doc.bufferIds,
      scenarioId,
      scenarioRevision: 1,
    };
    const unsigned = {
      previewId,
      scenarioId,
      scenarioRevision: 1,
      sessionId: this.sessionId,
      sourceRevision: base.sourceRevision,
      baseSnapshotId: base.snapshotId,
      target: clone(request.target),
      changes: clone(request.changes),
      patches: changed.patches,
      snapshot,
      diff: request.changes.map((c) => ({
        name:
          c.name +
          (c.op === "rename"
            ? " · 名称"
            : c.op === "set_unit"
              ? " · 单位"
              : ""),
        before:
          c.op === "rename"
            ? c.name
            : c.op === "set_unit"
              ? (base.model.units[c.name] ?? "")
              : base.model.nodes.find((n) => n.name === c.name)!.expression,
        after:
          c.op === "rename"
            ? c.newName
            : c.op === "set_unit"
              ? c.unit
              : c.op === "set_input"
                ? c.literal
                : c.expression,
      })),
      resultDiff: model.outputs.map((name) => ({
        name,
        before:
          base.values[
            request.changes.find((c) => c.op === "rename" && c.newName === name)
              ?.name ?? name
          ],
        after: snapshot.values[name],
        beforeUnit:
          base.units[
            request.changes.find((c) => c.op === "rename" && c.newName === name)
              ?.name ?? name
          ],
        afterUnit: snapshot.units[name],
      })),
      createdAt: new Date().toISOString(),
    };
    for (const node of base.model.nodes) {
      const renamed = request.changes.find(
        (c) => c.op === "rename" && c.name === node.name,
      );
      const name = renamed?.op === "rename" ? renamed.newName : node.name;
      const next = model.nodes.find((n) => n.name === name)!;
      if (
        node.kind === "input" &&
        node.expression !== next.expression &&
        !request.changes.some(
          (c) => c.op === "set_input" && c.name === node.name,
        )
      )
        unsigned.diff.push({
          name: name + " · 数值换算",
          before: node.expression,
          after: next.expression,
        });
      const before = base.model.controls[node.name],
        after = model.controls[name];
      if (before && after && JSON.stringify(before) !== JSON.stringify(after))
        unsigned.diff.push({
          name: name + " · 范围与步长",
          before: JSON.stringify(before),
          after: JSON.stringify(after),
        });
    }
    const preview: Preview = {
      ...unsigned,
      previewDigest: digest({ candidate: unsigned, source: changed.source }),
    };
    this.candidates.set(previewId, {
      preview: clone(preview),
      before: doc.source,
      after: changed.source,
      consumed: false,
    });
    while (this.candidates.size > 200)
      this.candidates.delete(this.candidates.keys().next().value!);
    return clone(preview);
  }
  // Called only by the plugin's UI callback. No CLI route creates approvals or grants.
  approveFromUI(previewId: string, previewDigest: string) {
    const c = this.candidates.get(previewId);
    if (!c || c.preview.previewDigest !== previewDigest)
      throw new CalcError("DIGEST", "候选不存在或摘要不匹配");
    this.approvals.add(previewDigest);
  }
  private checkPermission(p: Preview) {
    this.checkTarget(p.target);
    const grant = this.grants().find(
      (g) =>
        g.path === p.target.path &&
        g.modelId === p.target.modelId &&
        p.changes.every((change) => {
          if (change.op !== "set_input" || !g.inputs.includes(change.name))
            return false;
          const source = this.candidates.get(p.previewId)!.before;
          const model = this.model(source, p.target.modelId);
          const node = model.nodes.find((n) => n.name === change.name)!;
          const before = inputQuantity(
              node.expression,
              model.units[change.name],
            ),
            after = p.snapshot.quantities[change.name];
          return (
            sameDimension(before.dimension, after.dimension) &&
            before.absolute === after.absolute
          );
        }),
    );
    if (!this.approvals.has(p.previewDigest) && !grant)
      throw new CalcError("PERMISSION", "没有此候选的界面批准或限定输入授权");
  }
  commit(
    request: {
      sessionId: string;
      previewId: string;
      previewDigest: string;
      requestId: string;
    },
    source: "ui" | "agent" = "agent",
  ): Promise<Receipt> {
    const work = () => this.commitNow(request, source);
    const task = this.queue.then(work, work);
    this.queue = task.catch(() => {});
    return task;
  }
  private async commitNow(
    request: {
      sessionId: string;
      previewId: string;
      previewDigest: string;
      requestId: string;
    },
    source: "ui" | "agent",
  ) {
    if (!request.requestId || request.requestId.length > 128)
      throw new CalcError("REQUEST", "需要最长 128 字符的 requestId");
    if (request.sessionId !== this.sessionId)
      throw new CalcError("SESSION", "会话已变化");
    const requestDigest = digest({ request, source }),
      retried = this.receipts.get(request.requestId);
    if (retried) {
      if (retried.digest !== requestDigest)
        throw new CalcError("REQUEST_REUSE", "requestId 已用于其他提交");
      return clone(retried.receipt);
    }
    const c = this.candidates.get(request.previewId);
    if (!c || c.consumed)
      throw new CalcError("PREVIEW", "候选不存在、已丢弃或已应用");
    const p = c.preview;
    if (p.previewDigest !== request.previewDigest)
      throw new CalcError("DIGEST", "候选摘要不匹配");
    this.checkTarget(p.target);
    this.checkPermission(p);
    const current = await this.inspect(p.target);
    if (
      current.sourceRevision !== p.sourceRevision ||
      current.snapshotId !== p.baseSnapshotId
    )
      throw new CalcError("STALE", "源文档已变化，拒绝覆盖");
    const checked = patchModel(
      c.before,
      this.model(c.before, p.target.modelId),
      p.changes,
      false,
    );
    if (checked.source !== c.after)
      throw new CalcError("DIGEST", "候选数据被修改");
    const validated = await this.evaluateModel(
      this.model(c.after, p.target.modelId),
    );
    if (validated.status !== "valid")
      throw new CalcError(
        "INVALID_MODEL",
        validated.diagnostics.map((d) => d.message).join("；"),
        undefined,
        { diagnostics: validated.diagnostics },
      );
    if (
      this.revision(
        p.target.path,
        (await this.adapter.read(p.target.path)).source,
      ) !== p.sourceRevision
    )
      throw new CalcError("STALE", "提交校验期间源文档已变化");
    this.checkPermission(p);
    const result = await this.adapter.write(
      p.target.path,
      c.before,
      c.after,
      checked.patches,
      () => {
        this.checkPermission(p);
        if (this.currentRevision(p.target.path) !== p.sourceRevision)
          throw new CalcError("STALE", "写入前源版本已变化");
      },
    );
    if (!result.applied)
      throw new CalcError("SAVE_FAILED", result.error ?? "写入失败");
    c.consumed = true;
    this.approvals.delete(p.previewDigest);
    this.observe(p.target.path, c.after);
    this.invalidate(p.target.path);
    for (const view of this.views.values())
      if (view.scenarioId === p.scenarioId) view.scenarioId = undefined;
    const receipt: Receipt = {
      receiptId: randomUUID(),
      requestId: request.requestId,
      previewId: p.previewId,
      target: clone(p.target),
      beforeRevision: p.sourceRevision,
      afterRevision: this.revision(p.target.path, c.after),
      ...result,
      source,
      createdAt: new Date().toISOString(),
    };
    this.receipts.set(request.requestId, { digest: requestDigest, receipt });
    while (this.receipts.size > 100)
      this.receipts.delete(this.receipts.keys().next().value!);
    return clone(receipt);
  }
  discard(id: string) {
    const c =
      this.candidates.get(id) ??
      [...this.candidates.values()].find((c) => c.preview.scenarioId === id);
    if (!c) throw new CalcError("PREVIEW", "候选不存在");
    this.approvals.delete(c.preview.previewDigest);
    this.candidates.delete(c.preview.previewId);
    for (const v of this.views.values())
      if (v.scenarioId === c.preview.scenarioId) v.scenarioId = undefined;
    return { discarded: true };
  }
  listPreviews(target: Target) {
    return [...this.candidates.values()]
      .filter(
        (c) =>
          !c.consumed &&
          JSON.stringify(c.preview.target) === JSON.stringify(target),
      )
      .map((c) => clone(c.preview));
  }
  async explain(
    target: Target,
    name: string,
    selection?: { scenarioId?: string; viewId?: string },
  ) {
    const snapshot = await this.inspect(target, selection);
    if (snapshot.viewState?.resultsCurrent === false)
      throw new CalcError("STALE", "视图输入未通过校验，显示的是上次有效结果");
    const node = snapshot.model.nodes.find((n) => n.name === name);
    if (!node) throw new CalcError("UNDEFINED", "变量不存在");
    if (snapshot.nodeStates[name] !== "valid")
      throw new CalcError(
        "INVALID_MODEL",
        "此行计算无效或依赖错误行",
        undefined,
        {
          diagnostics: snapshot.diagnostics.filter((d) => d.variable === name),
        },
      );
    return {
      snapshotId: snapshot.snapshotId,
      sourceRevision: snapshot.sourceRevision,
      name,
      kind: node.kind,
      expression: node.expression,
      value: snapshot.values[name],
      display: snapshot.displayValues[name],
      unit: snapshot.units[name] ?? "",
      quantity: snapshot.quantities[name],
      dependencies: node.deps.map((name) => ({
        name,
        value: snapshot.values[name],
        display: snapshot.displayValues[name],
        unit: snapshot.units[name] ?? "",
        quantity: snapshot.quantities[name],
      })),
      policy: POLICY,
    };
  }
  async receiptList() {
    const list = [];
    for (const stored of this.receipts.values()) {
      const r = clone(stored.receipt);
      try {
        const doc = await this.adapter.read(r.target.path);
        const c = this.candidates.get(r.previewId);
        if (c && doc.source === c.after) r.saveStatus = doc.saveStatus;
      } catch {
        r.saveStatus = "failed";
      }
      list.push(r);
    }
    return list;
  }
  async retractPreview(receiptId: string) {
    const stored = [...this.receipts.values()].find(
      (r) => r.receipt.receiptId === receiptId,
    );
    if (!stored) throw new CalcError("RECEIPT", "回执不存在");
    const c = this.candidates.get(stored.receipt.previewId);
    if (!c) throw new CalcError("RECEIPT", "恢复记录已过期");
    const base = await this.inspect(stored.receipt.target);
    if (base.sourceRevision !== stored.receipt.afterRevision)
      throw new CalcError("STALE", "提交后笔记已变化，不能自动撤回");
    const old = this.model(c.before, base.target.modelId);
    const changes: Change[] = c.preview.changes.map((change) => {
      const name = c.preview.changes.find(
        (c) => c.op === "rename" && c.name === change.name,
      );
      const currentName = name?.op === "rename" ? name.newName : change.name;
      const n = old.nodes.find((n) => n.name === change.name)!;
      if (change.op === "rename")
        return { op: "rename", name: currentName, newName: change.name };
      if (change.op === "set_unit")
        return {
          op: "set_unit",
          name: currentName,
          unit: old.units[change.name] ?? "",
        };
      return change.op === "set_input"
        ? { op: "set_input", name: currentName, literal: n.expression }
        : { op: "set_formula", name: currentName, expression: n.expression };
    });
    for (const change of c.preview.changes)
      if (
        change.op === "set_unit" &&
        old.nodes.find((n) => n.name === change.name)?.kind === "input" &&
        !c.preview.changes.some(
          (c) => c.op === "set_input" && c.name === change.name,
        )
      ) {
        const renamed = c.preview.changes.find(
          (c) => c.op === "rename" && c.name === change.name,
        );
        changes.push({
          op: "set_input",
          name: renamed?.op === "rename" ? renamed.newName : change.name,
          literal: old.nodes.find((n) => n.name === change.name)!.expression,
        });
      }
    return this.preview({
      target: base.target,
      sessionId: this.sessionId,
      sourceRevision: base.sourceRevision,
      baseSnapshotId: base.snapshotId,
      changes,
    });
  }
  async dispatch(command: string, args: any) {
    switch (command) {
      case "capabilities":
        return this.capabilities();
      case "list_models":
        return this.listModels();
      case "inspect":
        return this.inspect(args.target, args);
      case "preview":
        return this.preview(args);
      case "commit":
        return this.commit(args);
      case "explain":
        return this.explain(args.target, args.name, args);
      case "discard":
        return this.discard(args.previewId ?? args.scenarioId);
      case "export":
        return {
          ...(await this.inspect(args.target, args)),
          generatedAt: new Date().toISOString(),
        };
      case "receipts":
        return this.receiptList();
      default:
        throw new CalcError("COMMAND", "未知命令");
    }
  }
}
