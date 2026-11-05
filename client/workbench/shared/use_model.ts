import { useEffect, useState } from "preact/hooks";

/** Re-renders the caller whenever the model notifies its subscribers. */
export function useModel<M extends { subscribe(fn: () => void): () => void }>(
  model: M,
): M {
  const [, setTick] = useState(0);
  useEffect(() => model.subscribe(() => setTick((t) => t + 1)), [model]);
  return model;
}
