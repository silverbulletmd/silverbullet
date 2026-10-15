/**
 * The state behind the search admin components, shared by Server's
 * dashboard (admin API) and Desktop's (IPC): each host passes an adapter.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  CatalogModel,
  SearchModelState,
  SpaceSearchInfo,
} from "../types/search_admin.ts";
import { usePolledLoad } from "./polling.ts";
import {
  rebuildConfirmText,
  removeModelConfirmText,
} from "./search_admin_format.ts";
import {
  BUSY_POLL_MS,
  indexesBusy,
  modelActive,
} from "./search_admin_model.ts";

/** The message for a failure; null when the host handled it itself. */
type ErrorText = (cause: unknown) => string | null;

export type ConfirmedActionOptions = {
  /** The confirmation before acting on `key`; null: nothing to act on. */
  question: (key: string) => string | null;
  run: (key: string) => Promise<void>;
  onError: (cause: unknown) => void;
};

export type ConfirmedAction = {
  /** The keys whose action is running. */
  running: Record<string, boolean>;
  start: (key: string) => Promise<void>;
};

/**
 * An action on one of several keys (a space's Rebuild): asks first, marks
 * the key running meanwhile and reports a failure.
 */
export function useConfirmedAction({
  question,
  run,
  onError,
}: ConfirmedActionOptions): ConfirmedAction {
  const [running, setRunning] = useState<Record<string, boolean>>({});
  async function start(key: string) {
    const ask = question(key);
    if (ask === null || !confirm(ask)) return;
    setRunning((r) => ({ ...r, [key]: true }));
    try {
      await run(key);
    } catch (cause) {
      onError(cause);
    } finally {
      setRunning((r) => ({ ...r, [key]: false }));
    }
  }
  return { running, start };
}

export type SearchModelHost<T extends SearchModelState> = {
  get: () => Promise<T>;
  set: (id: string | null) => Promise<T>;
  /** Removes a stored model; the state afterwards. */
  remove: (id: string) => Promise<T>;
  /**
   * The confirmation before changing the model of `state` from `from` to
   * `to` (null: none); null when nothing needs confirming.
   */
  changeQuestion: (
    state: T,
    from: CatalogModel | null,
    to: CatalogModel | null,
  ) => string | null | Promise<string | null>;
  /** Where stored models live, for the remove confirmation: "the server". */
  storedWhere: string;
  errorText: ErrorText;
  /**
   * Whether to poll; by default while the model downloads. A host whose
   * state also holds its spaces' indexes polls for those too.
   */
  active?: (state: T) => boolean;
};

export type SearchModelSection<T> = {
  state: T | undefined;
  error: string;
  /** While a change is applied. */
  busy: boolean;
  select: (id: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Loads the state anew, e.g. after an action elsewhere changed it. */
  reload: () => Promise<void>;
};

/** Chooses, downloads and removes the search model, with confirmations. */
export function useSearchModel<T extends SearchModelState>(
  host: SearchModelHost<T>,
): SearchModelSection<T> {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = (cause: unknown) => {
    const message = host.errorText(cause);
    if (message !== null) setError(message);
  };
  const active = host.active ?? modelActive;
  const { data, reload, show, refresh } = usePolledLoad(host.get, {
    pollMs: (state) => (state && active(state) ? BUSY_POLL_MS : null),
    onError: fail,
  });

  async function select(id: string | null) {
    if (!data || id === data.model) return;
    const byId = (m: string | null) =>
      data.catalog.find((c) => c.id === m) ?? null;
    setBusy(true);
    try {
      const question = await host.changeQuestion(
        data,
        byId(data.model),
        byId(id),
      );
      if (question && !confirm(question)) {
        // The select already shows the new choice: re-render the saved one.
        refresh();
        return;
      }
      setError("");
      show(await host.set(id));
    } catch (cause) {
      fail(cause);
      void reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const stored = data?.stored.find((s) => s.id === id);
    if (!stored || !confirm(removeModelConfirmText(stored, host.storedWhere))) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      show(await host.remove(id));
    } catch (cause) {
      fail(cause);
      void reload();
    } finally {
      setBusy(false);
    }
  }

  return { state: data, error, busy, select, remove, reload };
}

export type SpaceSearchHost<T extends SpaceSearchInfo> = {
  get: () => Promise<T>;
  /** Starts a rebuild; the space's search info afterwards. */
  rebuild: () => Promise<T>;
  /** Calls `changed` when the space's search may have changed elsewhere; returns the unsubscribe. */
  subscribe?: (changed: () => void) => () => void;
  errorText: ErrorText;
};

export type SpaceSearchOptions = {
  /** Reloads whenever one changes (the space's id, a saved choice). */
  deps: unknown[];
  /** False holds off loading and polling. */
  enabled?: boolean;
  /** How often to poll while nothing builds; null: not then. */
  idlePollMs: number | null;
};

export type SpaceSearchStatus<T> = {
  info: T | undefined;
  error: string;
  /** While a rebuild is being started. */
  rebuilding: boolean;
  rebuild: () => Promise<void>;
};

/** A space's search info, polled while an index builds, and its Rebuild. */
export function useSpaceSearch<T extends SpaceSearchInfo>(
  host: SpaceSearchHost<T>,
  { deps, enabled = true, idlePollMs }: SpaceSearchOptions,
): SpaceSearchStatus<T> {
  const [error, setError] = useState("");
  const fail = (cause: unknown) => {
    const message = host.errorText(cause);
    if (message !== null) setError(message);
  };
  const { data, reload, show } = usePolledLoad(host.get, {
    pollMs: (info) =>
      info === undefined
        ? null
        : indexesBusy(info.indexes)
          ? BUSY_POLL_MS
          : idlePollMs,
    deps,
    enabled,
    onLoad: () => setError(""),
    onError: fail,
  });

  const latestReload = useRef(reload);
  latestReload.current = reload;
  useEffect(() => {
    if (!enabled || !host.subscribe) return;
    return host.subscribe(() => void latestReload.current());
  }, [enabled, ...deps]);

  const rebuilds = useConfirmedAction({
    question: () => (data ? rebuildConfirmText() : null),
    run: async () => show(await host.rebuild()),
    onError: fail,
  });

  return {
    info: data,
    error,
    rebuilding: !!rebuilds.running[""],
    rebuild: () => rebuilds.start(""),
  };
}
