import { evaluate, Previous } from "./engine";
const cache = new Map<string, Previous>();
globalThis.onmessage = (event: MessageEvent) => {
  const { id, model, key, previous } = event.data;
  try {
    const result = evaluate(model, previous ?? cache.get(key));
    if (key) {
      cache.set(key, {
        model,
        values: result.values,
        quantities: result.quantities,
        status: result.status,
      });
      while (cache.size > 100) cache.delete(cache.keys().next().value!);
    }
    globalThis.postMessage({ id, result, model });
  } catch (error) {
    globalThis.postMessage({
      id,
      error: { code: (error as any).code ?? "ENGINE", message: String(error) },
    });
  }
};
