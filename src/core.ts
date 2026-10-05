/** Portable entry point. No Obsidian, CodeMirror, DOM, Node, or UI imports. */
import { models } from "./document";
import { evaluate } from "./engine";
import { feedback } from "./feedback";
export { models, isInputExpression } from "./document";
export type { Model, Node, Diagnostic, Control } from "./document";
export {
  evaluate,
  patchModel,
  parseExpression,
  inputQuantity,
  displayValue,
} from "./engine";
export type { Evaluation, Change, Patch, Previous } from "./engine";
export { parseUnit, unitCapabilities } from "./units";
export { feedback } from "./feedback";
export function calculateMarkdown(source: string) {
  return models(source).map((model) => {
    const result = evaluate(model);
    return { model, result, feedback: feedback(model, result) };
  });
}
