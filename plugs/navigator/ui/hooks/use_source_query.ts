import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  type ActiveView,
  ctxKey,
  engine,
  type PanelSetters,
  type SharedRefs,
} from "../panel.ts";
import type { SegmentMeta, SourceCtx } from "../types.ts";

// Source-mode only: how long typing has to settle before the source runs
// again, and how long a request may be outstanding before it is worth saying
// so. Client-mode views never reach either -- they don't leave the iframe.
const SOURCE_DEBOUNCE_MS = 200;
const LOADING_AFTER_MS = 150;

/**
 * Source search mode: the phrase and the segment are the source's input, so
 * they re-invoke it -- debounced, and dropped if overtaken. Client mode never
 * gets here; its hot path stays inside the iframe.
 *
 * @returns whether a request has been outstanding long enough to say so.
 */
export function useSourceQuery({
  view,
  sourceMode,
  phrase,
  segments,
  segmentIndex,
  refs,
  set,
  publish,
}: {
  view?: ActiveView;
  sourceMode: boolean;
  phrase: string;
  segments?: SegmentMeta[];
  segmentIndex: number;
  refs: SharedRefs;
  set: PanelSetters;
  publish: () => void;
}): boolean {
  const [loading, setLoading] = useState(false);
  // Source-mode requests in flight, so a stale one settling doesn't clear the
  // loading indicator out from under the newer one still running.
  const outstanding = useRef(0);
  const { lastQueried } = refs;
  const { setSelectedIndex, setSelectedPath } = set;

  const runQuery = useCallback(
    async (ctx: SourceCtx) => {
      outstanding.current++;
      const spinner = setTimeout(() => setLoading(true), LOADING_AFTER_MS);
      try {
        // False means a newer request has already taken the view: its rows are
        // on screen, and these are the ones the user has moved past.
        if (!(await engine.query(ctx))) return;
        lastQueried.current = ctxKey(ctx);
        setSelectedIndex(0);
        setSelectedPath(undefined);
        publish();
      } finally {
        clearTimeout(spinner);
        if (--outstanding.current === 0) setLoading(false);
      }
    },
    [publish],
  );

  useEffect(() => {
    if (!view || !sourceMode) return;
    const ctx: SourceCtx = {
      phrase,
      segment: segments?.[segmentIndex]?.label,
    };
    if (ctxKey(ctx) === lastQueried.current) return;
    const timer = setTimeout(() => void runQuery(ctx), SOURCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [view, sourceMode, phrase, segments, segmentIndex, runQuery]);

  return loading;
}
