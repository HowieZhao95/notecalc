import { MarkdownRenderChild, MarkdownPostProcessorContext } from "obsidian";
import { randomUUID } from "node:crypto";
import { models, Model, IDENTIFIER } from "./document";
import { feedback } from "./feedback";
import type { Snapshot, Target } from "./runtime";
import type NoteCalcPlugin from "./main";

class PassiveReading extends MarkdownRenderChild {
  readonly viewId = "reading-" + randomUUID();
  private generation = 0;
  private alive = true;
  constructor(
    readonly plugin: NoteCalcPlugin,
    el: HTMLElement,
    readonly target: Target,
    readonly paint: (snapshot: Snapshot) => void,
  ) {
    super(el);
  }
  onload() {
    this.containerEl.dataset.notecalcViewId = this.viewId;
    this.plugin.listeners.add(this.refresh);
    this.register(() => {
      this.alive = false;
      this.generation++;
      this.plugin.listeners.delete(this.refresh);
      this.plugin.runtime.views.delete(this.viewId);
    });
    void this.refresh();
  }
  refresh = async () => {
    const generation = ++this.generation;
    this.plugin.runtime.views.set(this.viewId, {
      target: this.target,
      draft: { status: "calculating" },
    });
    this.containerEl.querySelectorAll(".notecalc-inline").forEach((el) => {
      el.textContent = " …";
    });
    try {
      const snapshot = await this.plugin.runtime.inspectLocal(this.target);
      if (!this.alive || generation !== this.generation) return;
      this.paint(snapshot);
      this.containerEl.dataset.notecalcSnapshotId = snapshot.snapshotId;
      this.plugin.runtime.views.set(this.viewId, {
        target: this.target,
        draft:
          snapshot.status === "valid"
            ? undefined
            : {
                status: "error",
                message: snapshot.diagnostics.map((d) => d.message).join("；"),
                sourceRevision: snapshot.sourceRevision,
              },
      });
    } catch (e) {
      if (!this.alive || generation !== this.generation) return;
      const message = String(e);
      this.containerEl
        .querySelectorAll(".notecalc-inline")
        .forEach((el) => el.remove());
      this.containerEl.createSpan({
        text: " ⚠ " + message,
        cls: "notecalc-inline notecalc-invalid",
      });
      this.plugin.runtime.views.set(this.viewId, {
        target: this.target,
        draft: { status: "error", message },
      });
    }
  };
}
const target = (
  plugin: NoteCalcPlugin,
  path: string,
  model: Model,
): Target => ({
  vaultId: plugin.runtime.adapter.vaultId,
  path,
  modelId: model.id,
});

export async function renderBlock(
  plugin: NoteCalcPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) {
  try {
    const doc = await plugin.runtime.adapter.read(ctx.sourcePath),
      all = models(doc.source),
      section = ctx.getSectionInfo(el);
    const explicit = source.match(/^\s*\/\/\s*@model\s+(\S+)\s*$/m)?.[1];
    const candidates = all.filter(
      (m) =>
        m.format === "block" &&
        (explicit
          ? m.id === explicit
          : section
            ? m.lineFrom === section.lineStart + 1
            : doc.source.slice(m.bodyFrom, m.to).trim() === source.trim()),
    );
    if (candidates.length !== 1) throw Error("无法唯一定位计算代码块");
    const m = candidates[0];
    el.empty();
    el.addClass("notecalc-reading");
    const code = el.createEl("pre").createEl("code");
    const body = doc.source.slice(m.bodyFrom, m.to),
      lines = body.replace(/\n$/, "").split("\n");
    const lineElements = new Map<number, HTMLElement>();
    for (let i = 0; i < lines.length; i++) {
      const row = code.createSpan({ cls: "notecalc-code-line" });
      row.createSpan({ text: lines[i].replace(/\r$/, "") });
      lineElements.set(m.lineFrom + 1 + i, row);
    }
    const child = new PassiveReading(
      plugin,
      el,
      target(plugin, ctx.sourcePath, m),
      (snapshot) => {
        el.querySelectorAll(".notecalc-inline").forEach((e) => e.remove());
        for (const item of feedback(snapshot.model, snapshot)) {
          const row = lineElements.get(item.line) ?? code;
          row.addClass("notecalc-line");
          row.createSpan({
            text: item.text,
            cls: "notecalc-inline" + (item.valid ? "" : " notecalc-invalid"),
            attr: { title: item.detail, "aria-label": item.detail },
          });
        }
      },
    );
    ctx.addChild(child);
  } catch (e) {
    el.empty();
    el.createEl("pre").createEl("code", { text: source });
    el.createSpan({
      text: " ⚠ " + String(e),
      cls: "notecalc-inline notecalc-invalid",
    });
  }
}

export async function renderLists(
  plugin: NoteCalcPlugin,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) {
  const items = Array.from(el.querySelectorAll("li"));
  if (!items.length) return;
  try {
    const doc = await plugin.runtime.adapter.read(ctx.sourcePath),
      all = models(doc.source).filter((m) => m.format === "markdown");
    for (const m of all) {
      const rows = new Map<number, { el: HTMLElement; name: string }>();
      const candidates = [
        ...m.nodes.map((n) => ({
          name: n.name,
          line: n.line,
          expression: n.expression,
        })),
        ...m.diagnostics
          .filter((d) => d.variable && d.line)
          .map((d) => ({
            name: d.variable!,
            line: d.line!,
            expression: undefined,
          })),
      ];
      for (const li of items) {
        if (li.querySelector(":scope > .notecalc-inline")) continue;
        const info = ctx.getSectionInfo(li);
        if (!info) continue;
        const inline = Array.from(li.querySelectorAll("code")).filter(
          (code) => code.closest("li") === li,
        );
        if (inline.length > 1) continue;
        const code = inline[0];
        const label = (li.textContent ?? "")
          .trim()
          .match(new RegExp(`^(${IDENTIFIER})[ \\t]*[：:]`, "u"))?.[1];
        const n = candidates.find(
          (n) =>
            !rows.has(n.line) &&
            n.name === label &&
            (n.expression === undefined ||
              n.expression === code?.textContent?.trim()) &&
            n.line >= info.lineStart + 1 &&
            n.line <= info.lineEnd + 1,
        );
        if (n) rows.set(n.line, { el: li, name: n.name });
      }
      if (!rows.size) continue;
      const anchor = rows.values().next().value!.el;
      const child = new PassiveReading(
        plugin,
        anchor,
        target(plugin, ctx.sourcePath, m),
        (snapshot) => {
          for (const row of rows.values())
            row.el
              .querySelectorAll(":scope > .notecalc-inline")
              .forEach((e) => e.remove());
          for (const item of feedback(snapshot.model, snapshot)) {
            const row = (
              rows.get(item.line) ??
              [...rows.values()].find((row) => row.name === item.name)
            )?.el;
            if (row) {
              row.addClass("notecalc-line");
              row.createSpan({
                text: item.text,
                cls:
                  "notecalc-inline" + (item.valid ? "" : " notecalc-invalid"),
                attr: { title: item.detail, "aria-label": item.detail },
              });
            }
          }
        },
      );
      ctx.addChild(child);
    }
  } catch (e) {
    /* Source-mode diagnostics remain available if renderer has no ranges. */
  }
}
