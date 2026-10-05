import { calculateMarkdown } from '../dist/notecalc-core.mjs';

self.onmessage = ({ data }) => {
  try {
    const calculations = calculateMarkdown(data.source);
    self.postMessage({
      revision: data.revision,
      calculations: calculations.map(({ model, result, feedback }) => ({
        id: model.id, status: result.status, values: result.values,
        displayValues: result.displayValues, diagnostics: result.diagnostics, feedback
      }))
    });
  } catch (error) {
    self.postMessage({ revision: data.revision, error: error.message });
  }
};
self.postMessage({ ready: true });
