import source from "notecalc:worker";
import { CalcError, Model, Evaluation, Previous } from "./engine";
export type EvaluateModel = (
  model: Model,
  key?: string,
  previous?: Previous,
) => Promise<Evaluation>;
export class EngineWorker {
  private worker?: Worker;
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (result: Evaluation) => void;
      reject: (error: unknown) => void;
      timer: number;
      model: Model;
    }
  >();
  private closed = false;
  readonly evaluate: EvaluateModel = (model, key, previous) => {
    if (this.closed)
      return Promise.reject(new CalcError("WORKER", "计算运行时已关闭"));
    if (!this.worker) {
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      try {
        this.worker = new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.worker.onmessage = (event) => {
        const data = event.data,
          entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        window.clearTimeout(entry.timer);
        if (data.error)
          entry.reject(new CalcError(data.error.code, data.error.message));
        else {
          entry.model.nodes.forEach((node, i) => {
            node.deps = data.model.nodes[i].deps;
          });
          entry.resolve(data.result);
        }
      };
      this.worker.onerror = () =>
        this.abort(new CalcError("WORKER", "计算 Worker 无法运行"));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = window.setTimeout(
        () => this.abort(new CalcError("TIMEOUT", "计算超时，已终止 Worker")),
        2000,
      );
      this.pending.set(id, { resolve, reject, timer, model });
      this.worker!.postMessage({ id, model, key, previous });
    });
  };
  private abort(error: unknown) {
    this.worker?.terminate();
    this.worker = undefined;
    for (const entry of this.pending.values()) {
      window.clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.closed = true;
    this.abort(new CalcError("WORKER", "插件已关闭"));
  }
}
