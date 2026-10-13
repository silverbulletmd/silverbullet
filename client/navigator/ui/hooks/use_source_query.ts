import { useCallback, useEffect } from "preact/hooks";
import type { SegmentMeta, SourceCtx } from "../../types.ts";
import { resolveDropdown } from "../dropdown.ts";
import type { NavigatorEngine } from "../engine.ts";
import {
  type ActiveView,
  ctxKey,
  type PanelSetters,
  type SharedRefs,
} from "../panel.ts";

const SOURCE_DEBOUNCE_MS = 200;

export function useSourceQuery({
  engine,
  view,
  sourceMode,
  phrase,
  segments,
  segmentIndex,
  dropdownValue,
  refs,
  set,
  publish,
}: {
  engine: NavigatorEngine;
  view?: ActiveView;
  sourceMode: boolean;
  phrase: string;
  segments?: SegmentMeta[];
  segmentIndex: number;
  dropdownValue: unknown;
  refs: SharedRefs;
  set: PanelSetters;
  publish: () => void;
}): void {
  const { lastQueried } = refs;
  const { setSelectedIndex, setSelectedPath } = set;

  const runQuery = useCallback(
    async (ctx: SourceCtx) => {
      if (!view || !(await engine.query(ctx, view.name))) return;
      lastQueried.current = ctxKey(ctx);
      setSelectedIndex(0);
      setSelectedPath(undefined);
      publish();
    },
    [publish, view?.name],
  );

  useEffect(() => {
    if (!view || !sourceMode) return;
    const ctx: SourceCtx = {
      phrase,
      segment: segments?.[segmentIndex]?.label,
      // A restored saved value is undefined until the options load, so it
      // triggers a second query once they do (accepted).
      dropdown: resolveDropdown(view.dropdownOptions, dropdownValue),
    };
    if (ctxKey(ctx) === lastQueried.current) return;
    const timer = setTimeout(() => void runQuery(ctx), SOURCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    view,
    view?.dropdownOptions,
    sourceMode,
    phrase,
    segments,
    segmentIndex,
    dropdownValue,
    runQuery,
  ]);
}
