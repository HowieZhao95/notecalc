import {
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Modal,
  Notice,
} from "obsidian";
import { randomUUID } from "node:crypto";
import { ObsidianAdapter } from "./adapter";
import { CommandService, Grant, Target } from "./runtime";
import { CalcError, models } from "./engine";
import { CommitModal } from "./ui";
import { renderBlock, renderLists } from "./reading";
import { livePreview } from "./live-preview";
import { MARKDOWN_EXAMPLE, BLOCK_EXAMPLE } from "./example";
import { EngineWorker } from "./evaluator";
type Settings = { scope: string; grants: Grant[] };
export default class NoteCalcPlugin extends Plugin {
  runtime!: CommandService;
  settings: Settings = { scope: "NoteCalc/", grants: [] };
  readonly listeners = new Set<() => void>();
  async onload() {
    const loaded = await this.loadData();
    if (loaded) {
      this.settings = {
        scope: typeof loaded.scope === "string" ? loaded.scope : "NoteCalc/",
        grants: Array.isArray(loaded.grants) ? loaded.grants : [],
      };
    }
    const engine = new EngineWorker();
    this.register(() => engine.close());
    this.runtime = new CommandService(
      new ObsidianAdapter(this.app),
      () => this.settings.scope,
      () => this.settings.grants,
      engine.evaluate,
    );
    this.addSettingTab(new NoteCalcSettings(this));
    this.registerEditorExtension(livePreview(this.runtime));
    this.app.workspace.detachLeavesOfType("notecalc-panel");
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        if (info.file) {
          this.runtime.observe(info.file.path, editor.getValue());
          this.notify();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") this.notify();
      }),
    );
    this.registerMarkdownCodeBlockProcessor("notecalc", (source, el, ctx) =>
      renderBlock(this, source, el, ctx),
    );
    this.registerMarkdownPostProcessor((el, ctx) => renderLists(this, el, ctx));
    this.addCommand({
      id: "insert-template",
      name: "插入 Markdown 计算笔记",
      editorCallback: (editor) =>
        editor.replaceSelection(
          MARKDOWN_EXAMPLE.replace(
            "delivery-note",
            "note-" + randomUUID().slice(0, 8),
          ),
        ),
    });
    this.addCommand({
      id: "insert-block",
      name: "插入简洁计算代码块",
      editorCallback: (editor) => editor.replaceSelection(BLOCK_EXAMPLE),
    });
    this.addCommand({
      id: "diagnostics",
      name: "查看当前笔记的结果与诊断",
      callback: () => void this.showDiagnostics(),
    });
    this.addCommand({
      id: "review-previews",
      name: "查看 Agent 候选修改",
      callback: () => void this.reviewPreviews(),
    });
    this.addCommand({
      id: "grant-inputs",
      name: "授权 Agent 修改当前模型的输入",
      callback: () => void this.grantInputs(),
    });
    this.addCommand({
      id: "revoke-grants",
      name: "撤销全部 Agent 写入授权",
      callback: async () => {
        this.settings.grants = [];
        await this.saveData(this.settings);
        new Notice("NoteCalc：已撤销全部 Agent 写入授权");
      },
    });
    this.addCommand({
      id: "receipts",
      name: "查看提交记录与撤回",
      callback: () => void this.showReceipts(),
    });
    if (typeof this.registerCliHandler === "function")
      for (const command of this.runtime.capabilities().commands)
        this.registerCliHandler(
          "notecalc:" + command,
          "NoteCalc " + command,
          { request: { value: "<json>", description: "结构化 JSON 请求" } },
          async (params) => {
            try {
              if (params.request && params.request.length > 100_000)
                throw new CalcError("LIMIT", "请求过大");
              const args = JSON.parse(params.request ?? "{}");
              if (!args || Array.isArray(args) || typeof args !== "object")
                throw new CalcError("REQUEST", "请求必须为对象");
              const result = await this.runtime.dispatch(command, args);
              this.notify();
              return JSON.stringify({ ok: true, result });
            } catch (e) {
              return JSON.stringify({
                ok: false,
                error: {
                  code: e instanceof CalcError ? e.code : "REQUEST",
                  message: e instanceof Error ? e.message : String(e),
                  details: e instanceof CalcError ? e.details : undefined,
                },
              });
            }
          },
        );
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
  onunload() {
    this.app.workspace.detachLeavesOfType("notecalc-panel");
    this.listeners.clear();
  }
  async currentTarget(): Promise<Target> {
    const file = this.app.workspace.getActiveFile();
    if (!file) throw new CalcError("FILE", "请先打开计算笔记");
    this.runtime.checkPath(file.path, false);
    const doc = await this.runtime.adapter.read(file.path),
      all = models(doc.source);
    if (!all.length) throw new CalcError("MODEL", "当前笔记没有计算区域");
    if (all.length === 1)
      return {
        vaultId: this.runtime.adapter.vaultId,
        path: file.path,
        modelId: all[0].id,
      };
    return new Promise((resolve, reject) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText("选择计算模型");
      let resolved = false;
      for (const m of all)
        modal.contentEl.createEl("button", { text: m.id }).onclick = () => {
          resolved = true;
          resolve({
            vaultId: this.runtime.adapter.vaultId,
            path: file.path,
            modelId: m.id,
          });
          modal.close();
        };
      modal.onClose = () => {
        if (!resolved) reject(new CalcError("CANCELLED", "已取消"));
      };
      modal.open();
    });
  }
  async showDiagnostics() {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file) throw new CalcError("FILE", "请先打开笔记");
      const doc = await this.runtime.adapter.read(file.path),
        all = models(doc.source),
        modal = new Modal(this.app);
      modal.titleEl.setText("计算结果与诊断");
      if (!all.length)
        modal.contentEl.createEl("p", {
          text: "没有计算区域。用命令“插入 Markdown 计算笔记”创建。",
        });
      for (const m of all) {
        const s = await this.runtime.inspectLocal({
          vaultId: this.runtime.adapter.vaultId,
          path: file.path,
          modelId: m.id,
        });
        modal.contentEl.createEl("h3", { text: m.id });
        modal.contentEl.createEl("pre").createEl("code", {
          text: [
            Object.entries(s.displayValues)
              .map(([name, value]) => name + " = " + value)
              .join("\n"),
            s.diagnostics
              .map((d) => (d.line ? "第 " + d.line + " 行：" : "") + d.message)
              .join("\n"),
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }
      modal.open();
    } catch (e) {
      new Notice(String(e));
    }
  }
  async reviewPreviews() {
    try {
      const target = await this.currentTarget();
      this.runtime.checkTarget(target);
      const choices = this.runtime.listPreviews(target),
        modal = new Modal(this.app);
      modal.titleEl.setText("Agent 候选修改");
      if (!choices.length)
        modal.contentEl.createEl("p", {
          text: "当前计算区域没有候选。直接编辑 Markdown 即可计算。",
        });
      for (const p of choices) {
        modal.contentEl.createEl("button", {
          text: p.diff.map((d) => d.name + " → " + d.after).join("，"),
        }).onclick = () => {
          modal.close();
          new CommitModal(this, p, () => {}).open();
        };
      }
      modal.open();
    } catch (e) {
      new Notice(String(e));
    }
  }
  async grantInputs() {
    try {
      const target = await this.currentTarget(),
        base = await this.runtime.inspect(target);
      if (base.status !== "valid")
        throw new CalcError("INVALID_BASE", "请先修复模型");
      const modal = new Modal(this.app);
      modal.titleEl.setText("限定 Agent 输入授权");
      modal.contentEl.createEl("p", {
        text: `仅授权 ${target.path} / ${target.modelId} 的勾选输入。公式修改仍需逐次在界面批准，输入约束与版本校验始终生效。`,
      });
      const selected = new Set<string>();
      for (const node of base.model.nodes.filter((n) => n.kind === "input"))
        new Setting(modal.contentEl).setName(node.name).addToggle((t) =>
          t.onChange((value) => {
            if (value) selected.add(node.name);
            else selected.delete(node.name);
          }),
        );
      modal.contentEl.createEl("button", {
        text: "保存限定授权",
        cls: "mod-cta",
      }).onclick = async () => {
        this.settings.grants = this.settings.grants.filter(
          (g) => g.path !== target.path || g.modelId !== target.modelId,
        );
        if (selected.size)
          this.settings.grants.push({
            path: target.path,
            modelId: target.modelId,
            inputs: [...selected],
          });
        await this.saveData(this.settings);
        modal.close();
        new Notice("NoteCalc：限定授权已保存");
      };
      modal.open();
    } catch (e) {
      new Notice(String(e));
    }
  }
  async showReceipts() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("NoteCalc 提交记录");
    const receipts = await this.runtime.receiptList();
    if (!receipts.length)
      modal.contentEl.createEl("p", { text: "当前会话暂无提交。" });
    for (const r of receipts.reverse()) {
      const row = modal.contentEl.createDiv();
      row.createEl("p", {
        text: `${r.target.path} · ${r.createdAt} · 已应用 · ${r.saveStatus}`,
      });
      row.createEl("button", { text: "预览撤回" }).onclick = async () => {
        try {
          const preview = await this.runtime.retractPreview(r.receiptId);
          new CommitModal(this, preview, () => {}).open();
        } catch (e) {
          new Notice(String(e));
        }
      };
    }
    modal.open();
  }
}
class NoteCalcSettings extends PluginSettingTab {
  constructor(readonly plugin: NoteCalcPlugin) {
    super(plugin.app, plugin);
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "NoteCalc" });
    containerEl.createEl("p", {
      text: "直接编辑 Markdown，结果与错误在行旁显示。Agent 候选可通过命令查看；候选和提交记录只在本次会话保留。",
    });
    new Setting(containerEl)
      .setName("允许访问的目录")
      .setDesc(
        "默认为 NoteCalc/。留空允许整个 Vault；目录内的 Markdown 可由工具读取。",
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.scope).onChange(async (value) => {
          if (value.startsWith("/") || value.split("/").includes("..")) {
            new Notice("需要 Vault 内相对目录");
            return;
          }
          this.plugin.settings.scope = value.trim();
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.notify();
        }),
      );
    new Setting(containerEl)
      .setName("Agent 输入写入授权")
      .setDesc(
        `${this.plugin.settings.grants.length} 个模型已有限授权。使用命令面板授权当前模型的选定输入。`,
      )
      .addButton((b) =>
        b.setButtonText("撤销全部").onClick(async () => {
          this.plugin.settings.grants = [];
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        }),
      );
    containerEl.createEl("p", {
      text: `会话：${this.plugin.runtime.sessionId}`,
    });
    containerEl.createEl("p", {
      text: "计算政策：34 位有效数字，HALF_EVEN；显示格式不改变计算值。支持 Markdown 标记区域中的列表，以及 notecalc 代码块。当前宿主适配仅支持 Obsidian 桌面。",
    });
  }
}
