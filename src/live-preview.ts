import { editorInfoField } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { models } from "./document";
import { feedback } from "./feedback";
import { CommandService } from "./runtime";
import { randomUUID } from "node:crypto";
class ResultWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly detail: string,
    readonly valid: boolean,
  ) {
    super();
  }
  eq(other: ResultWidget) {
    return (
      this.text === other.text &&
      this.detail === other.detail &&
      this.valid === other.valid
    );
  }
  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "notecalc-inline" + (this.valid ? "" : " notecalc-invalid");
    el.textContent = this.text;
    el.title = this.detail;
    el.setAttribute("aria-label", this.detail);
    el.setAttribute("contenteditable", "false");
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
/** Source remains the editor's document; decorations never replace it. */
export function livePreview(runtime: CommandService) {
  const resultEffect = StateEffect.define<DecorationSet>();
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (tr.docChanged) value = Decoration.none;
      for (const effect of tr.effects)
        if (effect.is(resultEffect)) value = effect.value;
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const plugin = ViewPlugin.fromClass(
    class {
      generation = 0;
      destroyed = false;
      timer?: number;
      ids = new Map<string, string>();
      constructor(readonly view: EditorView) {
        this.schedule();
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.startState.field(editorInfoField, false)?.file?.path !==
            update.state.field(editorInfoField, false)?.file?.path
        )
          this.schedule();
      }
      schedule() {
        this.generation++;
        for (const id of this.ids.values()) {
          const state = runtime.views.get(id);
          if (state) state.draft = { status: "calculating" };
        }
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = undefined;
          void this.refresh();
        }, 60);
      }
      async refresh() {
        if (this.destroyed) return;
        if (this.view.composing) {
          this.schedule();
          return;
        }
        const generation = this.generation,
          source = this.view.state.doc.toString(),
          info = this.view.state.field(editorInfoField, false),
          ranges = [];
        const current = new Set<string>();
        try {
          if (info?.file) {
            runtime.observe(info.file.path, source);
            for (const m of models(source)) {
              const key = info.file.path + "\0" + m.id;
              current.add(key);
              let id = this.ids.get(key);
              if (!id) {
                id = "editor-" + randomUUID();
                this.ids.set(key, id);
              }
              const target = {
                vaultId: runtime.adapter.vaultId,
                path: info.file.path,
                modelId: m.id,
              };
              runtime.views.set(id, {
                target,
                draft: { status: "calculating" },
              });
              try {
                const snapshot = await runtime.inspectLocal(target);
                if (this.destroyed || generation !== this.generation) return;
                runtime.views.set(id, {
                  target,
                  draft:
                    snapshot.status === "valid"
                      ? undefined
                      : {
                          status: "error",
                          message: snapshot.diagnostics
                            .map((d) => d.message)
                            .join("；"),
                          sourceRevision: snapshot.sourceRevision,
                        },
                });
                for (const item of feedback(snapshot.model, snapshot)) {
                  if (item.line <= this.view.state.doc.lines) {
                    const line = this.view.state.doc.line(item.line);
                    ranges.push(
                      Decoration.line({
                        attributes: { class: "notecalc-line" },
                      }).range(line.from),
                    );
                    ranges.push(
                      Decoration.widget({
                        widget: new ResultWidget(
                          item.text,
                          item.detail,
                          item.valid,
                        ),
                        side: 1,
                      }).range(line.to),
                    );
                  }
                }
              } catch (e) {
                if (this.destroyed || generation !== this.generation) return;
                const message = e instanceof Error ? e.message : String(e);
                runtime.views.set(id, {
                  target,
                  draft: { status: "error", message },
                });
                const line = this.view.state.doc.line(m.lineFrom);
                ranges.push(
                  Decoration.line({
                    attributes: { class: "notecalc-line" },
                  }).range(line.from),
                );
                ranges.push(
                  Decoration.widget({
                    widget: new ResultWidget(" ⚠ " + message, message, false),
                    side: 1,
                  }).range(line.to),
                );
              }
            }
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          ranges.push(
            Decoration.line({ attributes: { class: "notecalc-line" } }).range(
              0,
            ),
          );
          ranges.push(
            Decoration.widget({
              widget: new ResultWidget(" ⚠ " + message, message, false),
              side: 1,
            }).range(this.view.state.doc.line(1).to),
          );
        }
        if (
          this.destroyed ||
          generation !== this.generation ||
          this.view.state.doc.toString() !== source
        )
          return;
        for (const [key, id] of this.ids)
          if (!current.has(key)) {
            runtime.views.delete(id);
            this.ids.delete(key);
          }
        if (this.view.composing) {
          this.schedule();
          return;
        }
        this.view.dispatch({
          effects: resultEffect.of(Decoration.set(ranges, true)),
        });
      }
      destroy() {
        this.destroyed = true;
        this.generation++;
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        for (const id of this.ids.values()) runtime.views.delete(id);
      }
    },
  );
  return [field, plugin];
}
