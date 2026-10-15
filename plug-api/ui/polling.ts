import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Runs `load` every `intervalMs` while `active` and the document is visible.
 * A tick is skipped while the previous load is still running. Stops when
 * `active` turns false and on unmount.
 */
export function usePolling(
  load: () => Promise<void>,
  intervalMs: number,
  active: boolean,
): void {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    if (!active) return;
    let running = false;
    const timer = setInterval(() => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      void latest
        .current()
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
}

export type PolledLoadOptions<T> = {
  /** How often to poll with `data` loaded; null: don't. */
  pollMs: (data: T | undefined) => number | null;
  /** Loads on mount and whenever one of these changes. */
  deps?: unknown[];
  /** False holds off loading and polling. */
  enabled?: boolean;
  /** Each answer shown, loaded or passed to `show`. */
  onLoad?: (data: T) => void;
  /** A load's failure, unless a newer load or `show` overtook it. */
  onError: (cause: unknown) => void;
};

export type PolledLoad<T> = {
  data: T | undefined;
  /** Loads anew. */
  reload: () => Promise<void>;
  /** Shows `next` (a change's answer), dropping loads still in flight. */
  show: (next: T) => void;
  /** Renders the data shown again, e.g. to reset a select after a cancel. */
  refresh: () => void;
};

/**
 * Loads `fetch`'s answer and keeps it fresh by polling. A slow answer that
 * lands after a newer load or `show` is dropped.
 */
export function usePolledLoad<T>(
  fetch: () => Promise<T>,
  { pollMs, deps = [], enabled = true, onLoad, onError }: PolledLoadOptions<T>,
): PolledLoad<T> {
  const [data, setData] = useState<T>();
  const request = useRef(0);
  const callbacks = useRef({ fetch, onLoad, onError });
  callbacks.current = { fetch, onLoad, onError };

  const show = (next: T) => {
    request.current++;
    setData(next);
    callbacks.current.onLoad?.(next);
  };

  const reload = async () => {
    const sequence = ++request.current;
    try {
      const next = await callbacks.current.fetch();
      if (sequence !== request.current) return;
      setData(next);
      callbacks.current.onLoad?.(next);
    } catch (cause) {
      if (sequence === request.current) callbacks.current.onError(cause);
    }
  };

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, ...deps]);

  const interval = enabled ? pollMs(data) : null;
  usePolling(reload, interval ?? 0, interval !== null);

  return {
    data,
    reload,
    show,
    refresh: () => setData((d) => (d === undefined ? d : { ...d })),
  };
}
