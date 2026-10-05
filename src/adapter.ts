import { App, MarkdownView, TFile } from "obsidian";
import { createHash } from "node:crypto";
import { CalcError, Patch } from "./engine";
import { DocumentAdapter, Document } from "./runtime";
export class ObsidianAdapter implements DocumentAdapter {
  readonly vaultId: string;
  constructor(readonly app: App) {
    this.vaultId = createHash("sha256")
      .update((app.vault.adapter as any).getBasePath?.() ?? app.vault.getName())
      .digest("hex")
      .slice(0, 24);
  }
  views(path: string) {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => ({
        id: (leaf as any).id as string,
        view: leaf.view as MarkdownView,
      }))
      .filter(
        (item) =>
          item.view.file?.path === path && item.view.getMode() === "source",
      );
  }
  file(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile))
      throw new CalcError("FILE", "Markdown 文件不存在");
    return file;
  }
  async read(path: string): Promise<Document> {
    const file = this.file(path),
      disk = await this.app.vault.read(file);
    const views = this.views(path);
    const buffers = [...new Set(views.map((v) => v.view.editor.getValue()))];
    if (buffers.length > 1)
      throw new CalcError(
        "AMBIGUOUS_BUFFER",
        "存在内容不同的编辑缓冲区，请先解决歧义",
      );
    const source = buffers[0] ?? disk;
    return {
      source,
      saveStatus: source === disk ? "saved" : "unsaved",
      bufferIds: views.map((v) => v.id),
    };
  }
  async list() {
    return this.app.vault.getMarkdownFiles().map((f) => f.path);
  }
  async write(
    path: string,
    expected: string,
    next: string,
    patches: Patch[],
    checkRevision?: () => void,
  ) {
    const doc = await this.read(path);
    if (doc.source !== expected)
      throw new CalcError("STALE", "写入前源文档已变化");
    const views = this.views(path);
    if (views.length) {
      // Identical buffers in multiple views can be separate documents. Avoid an undo
      // group in one document overwriting another independent buffer.
      if (views.length > 1) {
        const cms = views.map((v) => (v.view.editor as any).cm?.state?.doc);
        if (cms.some((cm) => cm !== cms[0]))
          throw new CalcError(
            "AMBIGUOUS_BUFFER",
            "多个独立编辑缓冲区，关闭重复编辑视图后再应用",
          );
      }
      const editor = views[0].view.editor;
      if (editor.getValue() !== expected)
        throw new CalcError("STALE", "编辑器已变化");
      checkRevision?.();
      editor.transaction(
        {
          changes: patches.map((p) => ({
            from: editor.offsetToPos(p.from),
            to: editor.offsetToPos(p.to),
            text: p.text,
          })),
        },
        "notecalc",
      );
      if (editor.getValue() !== next)
        return {
          applied: true,
          saveStatus: "failed" as const,
          error: "编辑器返回内容与候选不符，请检查并撤销",
        };
      let error: string | undefined;
      for (let i = 0; i < 12; i++) {
        try {
          if ((await this.app.vault.read(this.file(path))) === next)
            return { applied: true, saveStatus: "saved" as const };
        } catch (e) {
          error = String(e);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {
        applied: true,
        saveStatus: error ? ("failed" as const) : ("unsaved" as const),
        error,
      };
    }
    try {
      await this.app.vault.process(this.file(path), (current) => {
        if (current !== expected)
          throw new CalcError("STALE", "磁盘文件已变化");
        checkRevision?.();
        return next;
      });
      return {
        applied: true,
        saveStatus: ((await this.app.vault.read(this.file(path))) === next
          ? "saved"
          : "failed") as Document["saveStatus"],
      };
    } catch (e) {
      if (e instanceof CalcError) throw e;
      return {
        applied: false,
        saveStatus: "failed" as const,
        error: String(e),
      };
    }
  }
}
