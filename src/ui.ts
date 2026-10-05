import { Modal, Notice } from "obsidian";
import { randomUUID } from "node:crypto";
import { displayValue } from "./engine";
import type { Preview } from "./runtime";
import type NoteCalcPlugin from "./main";
/** Explicit review only. All ordinary authoring happens in Markdown. */
export class CommitModal extends Modal {
  constructor(
    readonly plugin: NoteCalcPlugin,
    readonly preview: Preview,
    readonly after: () => void,
  ) {
    super(plugin.app);
  }
  onOpen() {
    const p = this.preview;
    this.titleEl.setText("应用 Agent 候选");
    this.contentEl.createEl("p", { text: p.target.path });
    const code = this.contentEl.createEl("pre").createEl("code");
    code.setText(
      p.diff.map((d) => `${d.name}\n- ${d.before}\n+ ${d.after}`).join("\n\n"),
    );
    for (const d of p.resultDiff)
      this.contentEl.createEl("p", {
        text: `${d.name}：${displayValue(d.before, d.beforeUnit)} → ${displayValue(d.after, d.afterUnit)}`,
      });
    this.contentEl.createEl("p", {
      text: "应用只修改列出的 Markdown 内容。打开的笔记可以正常撤销。",
    });
    const status = this.contentEl.createEl("p", { attr: { role: "status" } }),
      button = this.contentEl.createEl("button", {
        text: "应用到笔记",
        cls: "mod-cta",
      });
    button.onclick = async () => {
      button.disabled = true;
      try {
        this.plugin.runtime.approveFromUI(p.previewId, p.previewDigest);
        const r = await this.plugin.runtime.commit(
          {
            sessionId: p.sessionId,
            previewId: p.previewId,
            previewDigest: p.previewDigest,
            requestId: randomUUID(),
          },
          "ui",
        );
        new Notice(
          r.saveStatus === "saved"
            ? "NoteCalc：已应用并保存"
            : "NoteCalc：已应用，" +
              (r.saveStatus === "failed"
                ? "保存失败，请保留编辑器并复制内容"
                : "等待保存"),
        );
        this.after();
        this.plugin.notify();
        this.close();
      } catch (e) {
        status.setText(String(e));
        button.disabled = false;
      }
    };
    this.contentEl.createEl("button", { text: "关闭" }).onclick = () =>
      this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
}
