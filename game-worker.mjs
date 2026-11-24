// Web Worker for stuck detection (see game-stuck.mjs). Keeps the solver off the main thread.
import { runJob } from "./game-stuck.mjs";

self.onmessage = (e) => {
  let result;
  try { result = runJob(e.data); } catch { result = { timeout: true }; }
  self.postMessage({ id: e.data.id, result });
};
