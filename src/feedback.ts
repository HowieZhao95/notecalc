import type { Evaluation } from "./engine";
import type { Model } from "./document";
export type Feedback = {
  line: number;
  name?: string;
  text: string;
  detail: string;
  valid: boolean;
};
/** Plain feedback records: every host decides how to display them. */
export function feedback(model: Model, result: Evaluation): Feedback[] {
  const valid = model.nodes
    .filter(
      (n) => n.kind === "formula" && result.nodeStates[n.name] === "valid",
    )
    .map((n) => ({
      line: n.line,
      name: n.name,
      text: " → " + result.displayValues[n.name],
      detail:
        n.name +
        " = " +
        result.displayValues[n.name] +
        (n.deps.length ? "；依赖 " + n.deps.join("、") : ""),
      valid: true,
    }));
  const byLine = new Map<number, { messages: string[]; name?: string }>();
  for (const d of result.diagnostics) {
    const line = d.line ?? model.lineFrom;
    const list = byLine.get(line) ?? { messages: [], name: d.variable };
    list.messages.push(d.message);
    byLine.set(line, list);
  }
  return [
    ...valid,
    ...[...byLine].map(([line, { messages, name }]) => ({
      line,
      name,
      text: " ⚠ " + messages.join("；"),
      detail: `第 ${line} 行：` + messages.join("；"),
      valid: false,
    })),
  ].sort((a, b) => a.line - b.line);
}
