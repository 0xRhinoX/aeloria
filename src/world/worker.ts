import { generateWorld, transferables, type Quality } from './generate';

/** Grows a world off the main thread and hands back plain typed arrays. */
self.onmessage = (e: MessageEvent<{ seed: number; quality: Quality; id: number }>) => {
  const { seed, quality, id } = e.data;
  try {
    const t0 = performance.now();
    const world = generateWorld(seed, quality);
    (self as unknown as Worker).postMessage({ id, world, ms: performance.now() - t0 }, transferables(world));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
