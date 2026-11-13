import { useReducer, useRef } from "preact/hooks";
import type { Action } from "../shared/action.ts";
import { errorMessage } from "../shared/value_preview.ts";
import * as backend from "./libraries_backend.ts";
import {
  type InstallableLibrary,
  type InstalledLibrary,
  isBuiltinLibrary,
  isUpdatable,
  isUpdatableRepository,
  type LibrariesViewModel,
  type LibraryCheck,
} from "./libraries_backend.ts";
import { REPOSITORY_PAGE_PREFIX } from "./library_names.ts";
import {
  libraryLabel,
  removeBlockedMessage,
  requiredBy,
  requirersOf,
  sameLibraryUri,
} from "./library_requires.ts";

export type SectionKey = "installed" | "available" | "repositories";

/** What a `Library: …` command asks the Libraries tab to do once it shows */
export type LibrariesFocus =
  | "manager"
  | "install"
  | "addRepository"
  | "updateAll"
  | "updateAllRepositories";

export type UpdateProgress = {
  running: boolean;
  done: number;
  total: number;
  current: string;
};

export type RunResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type LibrariesState = {
  data: LibrariesViewModel;
  /** Whether `data` came from a refresh yet */
  loaded: boolean;
  busy: ReadonlySet<string>;
  errors: Partial<Record<SectionKey, string>>;
  infos: Partial<Record<SectionKey, string>>;
  /** Update status by page name, from the last Check for updates */
  checks?: Record<string, LibraryCheck>;
  checkedAt?: number;
  progress: UpdateProgress;
};

export type LibrariesEvent =
  | { type: "loaded"; data: LibrariesViewModel }
  /** A load that failed: the lists stay as they were, the error shows */
  | { type: "loadFailed"; message: string }
  | { type: "start"; key: string; section: SectionKey }
  | { type: "finish"; key: string }
  | { type: "error"; section: SectionKey; message?: string }
  | { type: "info"; section: SectionKey; message?: string }
  | { type: "checked"; checks: Record<string, LibraryCheck>; at?: number }
  | { type: "unchecked"; names: string[] }
  | { type: "progress"; progress: UpdateProgress };

export const EMPTY_LIBRARIES: LibrariesViewModel = {
  installed: [],
  installable: [],
  repositories: [],
  roguePlugs: [],
};

const IDLE: UpdateProgress = { running: false, done: 0, total: 0, current: "" };

export function initialLibrariesState(): LibrariesState {
  return {
    data: EMPTY_LIBRARIES,
    loaded: false,
    busy: new Set(),
    errors: {},
    infos: {},
    progress: IDLE,
  };
}

export function librariesReducer(
  state: LibrariesState,
  event: LibrariesEvent,
): LibrariesState {
  switch (event.type) {
    case "loaded": {
      // Statuses survive a refresh for rows that are still there
      const present = new Set([
        ...event.data.installed.map((l) => l.name),
        ...event.data.repositories.map((r) => r.name),
      ]);
      const kept = Object.entries(state.checks ?? {}).filter(([name]) =>
        present.has(name),
      );
      return {
        ...state,
        data: event.data,
        loaded: true,
        checks: state.checks && Object.fromEntries(kept),
      };
    }
    case "loadFailed":
      return {
        ...state,
        loaded: true,
        errors: { ...state.errors, installed: event.message },
      };
    case "unchecked": {
      if (!state.checks) return state;
      const checks = { ...state.checks };
      for (const name of event.names) delete checks[name];
      return { ...state, checks };
    }
    case "start":
      return {
        ...state,
        busy: new Set(state.busy).add(event.key),
        errors: { ...state.errors, [event.section]: undefined },
        infos: { ...state.infos, [event.section]: undefined },
      };
    case "finish": {
      const busy = new Set(state.busy);
      busy.delete(event.key);
      return { ...state, busy };
    }
    case "error":
      return {
        ...state,
        errors: { ...state.errors, [event.section]: event.message },
      };
    case "info":
      return {
        ...state,
        infos: { ...state.infos, [event.section]: event.message },
      };
    case "checked":
      return { ...state, checks: event.checks, checkedAt: event.at };
    case "progress":
      return { ...state, progress: event.progress };
  }
}

/** Until the first load succeeded or failed. */
export const isLoading = (state: LibrariesState) => !state.loaded;

/**
 * The toolbar's buttons. A read-only space gets none: besides not writing,
 * its server doesn't reach remotes, so there is nothing to check either.
 */
export function toolbar(opts: { writable: boolean; updatable: number }) {
  return {
    install: opts.writable,
    addRepository: opts.writable,
    check: opts.writable,
    updateAll: opts.writable && opts.updatable > 0,
  };
}

export const READ_ONLY_NOTE =
  "This space is read-only: libraries can't be installed, updated or removed here, nor checked for updates.";

/** The busy keys of the tab's own buttons; rows use {@link rowKey}, cards {@link installKey}. */
export const BUSY = {
  install: "install",
  addRepository: "repo:add",
  check: "check",
  updateAllRepositories: "repo:updateAll",
} as const;

export const installKey = (uri: string) => `install:${uri}`;

export type TaskDeps = {
  refresh: () => Promise<unknown>;
  dispatch: (event: LibrariesEvent) => void;
};

/**
 * Runs `task` busy under `key`; its failure lands in `section`'s banner,
 * never as a throw. With `refresh` (the default) the lists reload after it
 * succeeds.
 */
export async function runTask<T>(
  deps: TaskDeps,
  key: string,
  section: SectionKey,
  task: () => Promise<T>,
  { refresh = true } = {},
): Promise<RunResult<T>> {
  deps.dispatch({ type: "start", key, section });
  try {
    const data = await task();
    if (refresh) await deps.refresh();
    return { ok: true, data };
  } catch (e) {
    const error = errorMessage(e);
    deps.dispatch({ type: "error", section, message: error });
    return { ok: false, error };
  } finally {
    deps.dispatch({ type: "finish", key });
  }
}

export type RowKind = "library" | "plug" | "repository";

/** Where each kind of row reports, what it's called in a question, and how it goes. */
const KINDS: Record<
  RowKind,
  { section: SectionKey; noun: string; remove: (name: string) => Promise<void> }
> = {
  library: {
    section: "installed",
    noun: "library",
    remove: backend.removeLibrary,
  },
  plug: { section: "installed", noun: "plug", remove: backend.removePlug },
  repository: {
    section: "repositories",
    noun: "repository",
    remove: backend.removeRepository,
  },
};

export type LibraryRow = {
  kind: RowKind;
  /** Page name; a plug's file path */
  name: string;
  uri?: string;
  badge?: "built-in" | "dev mode" | "installed" | "Plug";
  /** From the last Check for updates */
  check?: LibraryCheck;
  updatable: boolean;
  removable: boolean;
  openable: boolean;
  /** A library's requirements */
  requires?: Requirement[];
  /** Why `requires` entries can't be used */
  requireErrors?: string[];
  /** The installed libraries that require this one, by page name */
  requiredBy?: string[];
  /** Why it can't be removed now: other installed libraries require it */
  removeBlocked?: string;
};

/** An installed library's name as a repository lists it, else its page's last segment. */
export const displayName = (installed: InstalledLibrary[], name: string) =>
  installed.find((l) => l.name === name)?.displayName ?? libraryLabel(name);

/** A library another one requires, and whether it is installed here. */
export type Requirement = { uri: string; label: string; installed: boolean };

export type AvailableLibrary = InstallableLibrary & {
  requirements: Requirement[];
};

export type AvailableGroup = {
  repo: string;
  label: string;
  libraries: AvailableLibrary[];
};

export type LibraryLists = {
  installed: LibraryRow[];
  groups: AvailableGroup[];
  repositories: LibraryRow[];
  /** Installed libraries Update all would update, filter aside */
  updatable: number;
};

export function libraryLists(
  data: LibrariesViewModel,
  query: string,
  checks: Record<string, LibraryCheck> = {},
  /** Repository pages the server ships (`bootConfig.bundledRepositories`) */
  bundledRepositories: readonly string[] = [],
): LibraryLists {
  const bundled = new Set(bundledRepositories);
  const label = (name: string) => displayName(data.installed, name);
  const requirements = (uris: string[] = []): Requirement[] =>
    uris.map((uri) => {
      const lib = data.installed.find(
        (l) => l.uri && sameLibraryUri(l.uri, uri),
      );
      const offered = data.installable.find((l) => sameLibraryUri(l.uri, uri));
      return {
        uri,
        label: lib ? label(lib.name) : (offered?.name ?? libraryLabel(uri)),
        installed: !!lib,
      };
    });
  const q = query.trim().toLowerCase();
  const has = (s: string | undefined) =>
    !q || (s ?? "").toLowerCase().includes(q);

  const libraries = data.installed
    .filter((l) => has(l.name))
    .map((l): LibraryRow => {
      const updatable = isUpdatable(l);
      const blockedBy = requirersOf(data.installed, l.name);
      return {
        kind: "library",
        name: l.name,
        uri: l.uri,
        badge: isBuiltinLibrary(l)
          ? "built-in"
          : l.mode === "push"
            ? "dev mode"
            : updatable
              ? "installed"
              : undefined,
        check: checks[l.name],
        updatable,
        removable: updatable,
        openable: true,
        requires: requirements(l.requires),
        requireErrors: l.requireErrors,
        requiredBy: requiredBy(data.installed, l.name),
        removeBlocked: blockedBy.length
          ? removeBlockedMessage(l.name, blockedBy, label)
          : undefined,
      };
    });
  const plugs = data.roguePlugs
    .filter((p) => has(p.path))
    .map(
      (p): LibraryRow => ({
        kind: "plug",
        name: p.path,
        badge: "Plug",
        updatable: false,
        removable: true,
        openable: false,
      }),
    );

  const byRepo = new Map<string, AvailableLibrary[]>();
  for (const lib of data.installable) {
    if (!(has(lib.name) || has(lib.description) || has(lib.repositoryPage))) {
      continue;
    }
    const repo = lib.repositoryPage || "(unknown)";
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo
      .get(repo)!
      .push({ ...lib, requirements: requirements(lib.requires) });
  }
  const groups = [...byRepo.entries()]
    .sort(([a], [b]) => {
      if (bundled.has(a) !== bundled.has(b)) return bundled.has(a) ? -1 : 1;
      return a.localeCompare(b);
    })
    .map(([repo, libraries]) => ({
      repo,
      label: repo.startsWith(REPOSITORY_PAGE_PREFIX)
        ? repo.slice(REPOSITORY_PAGE_PREFIX.length)
        : repo,
      libraries,
    }));

  const repositories = data.repositories.map((r): LibraryRow => {
    const isBundled = bundled.has(r.name);
    return {
      kind: "repository",
      name: r.name,
      uri: r.uri,
      badge: isBundled ? "built-in" : undefined,
      check: checks[r.name],
      updatable: isUpdatableRepository(r),
      removable: !!r.uri && !isBundled,
      openable: true,
    };
  });

  return {
    installed: [...libraries, ...plugs],
    groups,
    repositories,
    updatable: data.installed.filter(isUpdatable).length,
  };
}

/** The busy key a row's update, revert and remove run under. */
export const rowKey = (row: Pick<LibraryRow, "kind" | "name">) =>
  `${row.kind}:${row.name}`;

/** The section whose banners a row's actions report to. */
export const rowSection = (row: LibraryRow): SectionKey =>
  KINDS[row.kind].section;

export type RowDeps = {
  update: () => Promise<void>;
  revert: () => Promise<void>;
  remove: () => Promise<void>;
  open: () => Promise<void>;
  copy: () => Promise<void>;
};

/** A row's ⋯ menu, in order; a read-only space only opens and copies. */
export function rowActions(
  row: LibraryRow,
  writable: boolean,
  deps: RowDeps,
): Action<void>[] {
  const actions: Action<void>[] = [];
  // With only local edits there is nothing to update to: going back is the useful move
  if (writable && row.updatable) {
    actions.push(
      row.kind === "library" && row.check?.state === "localChanged"
        ? { label: "Revert", icon: "revert", run: deps.revert }
        : { label: "Update", icon: "reload", run: deps.update },
    );
  }
  if (row.openable) {
    actions.push({ label: "Open page", icon: "open", run: deps.open });
  }
  if (row.uri) {
    actions.push({ label: "Copy URI", icon: "copy", run: deps.copy });
  }
  if (writable && row.removable) {
    actions.push({
      label: "Remove",
      icon: "remove",
      run: deps.remove,
      disabled: row.removeBlocked,
    });
  }
  return actions;
}

export const removeMessage = (row: LibraryRow) =>
  `Remove ${KINDS[row.kind].noun} "${row.name}"?`;

export const revertMessage = (row: LibraryRow) =>
  `Discard your changes to "${row.name}" and restore the installed version?`;

/** Asks `message` before `act`; a failing dialog shows in the row's section, like a failing action. */
export async function confirmThen(
  row: LibraryRow,
  message: string,
  act: () => Promise<unknown>,
  deps: {
    confirm: (message: string) => Promise<boolean>;
    setError: (section: SectionKey, message?: string) => void;
  },
): Promise<void> {
  let confirmed: boolean;
  try {
    confirmed = await deps.confirm(message);
  } catch (e) {
    deps.setError(rowSection(row), errorMessage(e));
    return;
  }
  if (confirmed) await act();
}

/**
 * What the tab does each time it shows: reload (statuses go with the old
 * data), run a pending command request, and keep running new ones until
 * it hides. Returns the hide.
 */
export function whileShowing(deps: {
  reload: () => Promise<unknown>;
  take: () => LibrariesFocus | undefined;
  run: (focus: LibrariesFocus) => Promise<unknown> | undefined;
  subscribe: (listener: () => void) => () => void;
}): () => void {
  void deps.reload();
  const take = () => {
    const focus = deps.take();
    if (focus) void deps.run(focus);
  };
  take();
  return deps.subscribe(take);
}

/** What an install that pulled requirements in says. */
export const installedWithMessage = (
  r: { page: string; requirements: string[] },
  label: (name: string) => string = libraryLabel,
) =>
  `Installed ${label(r.page)} and what it requires: ${r.requirements.map(label).join(", ")}`;

export const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export type UpdateAllDeps = {
  ensureLoaded: () => Promise<LibrariesViewModel>;
  update: (lib: {
    name: string;
    uri: string;
  }) => Promise<RunResult<{ changed: boolean }>>;
  dispatch: (event: LibrariesEvent) => void;
  setError: (section: SectionKey, message?: string) => void;
  setInfo: (section: SectionKey, message?: string) => void;
};

/** Updates every updatable library in turn; does nothing while `guard` says another run is going. */
export async function updateAllLibraries(
  deps: UpdateAllDeps,
  guard: { running: boolean },
): Promise<void> {
  if (guard.running) return;
  guard.running = true;
  try {
    const { dispatch, setError, setInfo } = deps;
    const targets = (await deps.ensureLoaded()).installed.filter(isUpdatable);
    if (targets.length === 0) {
      setInfo("installed", "Nothing to update");
      return;
    }
    setError("installed", undefined);
    const total = targets.length;
    const updated: string[] = [];
    let firstError: string | undefined;
    try {
      for (let i = 0; i < total; i++) {
        const lib = targets[i];
        dispatch({
          type: "progress",
          progress: { running: true, done: i, total, current: lib.name },
        });
        const r = await deps.update({ name: lib.name, uri: lib.uri! });
        if (r.ok) {
          if (r.data.changed) updated.push(lib.name);
        } else if (!firstError) {
          firstError = `${lib.name}: ${r.error}`;
        }
      }
    } finally {
      dispatch({
        type: "progress",
        progress: { running: false, done: total, total, current: "" },
      });
    }
    dispatch({ type: "unchecked", names: updated });
    if (firstError) setError("installed", firstError);
    setInfo(
      "installed",
      updated.length === 0
        ? "All libraries already up to date"
        : `Updated ${plural(updated.length, "library", "libraries")}: ${updated.join(", ")}`,
    );
  } finally {
    guard.running = false;
  }
}

/** The Libraries tab's state and everything it can do. */
export function useLibraries(writable: boolean) {
  const [state, dispatch] = useReducer(
    librariesReducer,
    undefined,
    initialLibrariesState,
  );
  const latest = useRef(state);
  latest.current = state;
  // A showing's reload and a command's Update all may both ask for a load
  const loading = useRef<Promise<LibrariesViewModel>>();
  const updating = useRef({ running: false });

  const refresh = async (): Promise<LibrariesViewModel> => {
    const data = await backend.listLibraries();
    dispatch({ type: "loaded", data });
    return data;
  };
  const deps: TaskDeps = { refresh, dispatch };

  const setError = (section: SectionKey, message?: string) =>
    dispatch({ type: "error", section, message });
  const setInfo = (section: SectionKey, message?: string) =>
    dispatch({ type: "info", section, message });

  const run = <T>(
    key: string,
    section: SectionKey,
    task: () => Promise<T>,
    opts?: { refresh?: boolean },
  ) => runTask(deps, key, section, task, opts);

  /** Loads the libraries afresh, sharing a load already under way; a failure goes to Installed. */
  const reload = (): Promise<LibrariesViewModel> => {
    loading.current ??= refresh()
      .catch((e) => {
        dispatch({ type: "loadFailed", message: errorMessage(e) });
        return latest.current.data;
      })
      .finally(() => {
        loading.current = undefined;
      });
    return loading.current;
  };

  /** The libraries, waiting for a load under way or starting one if none ran yet. */
  const ensureLoaded = (): Promise<LibrariesViewModel> =>
    loading.current ??
    (latest.current.loaded ? Promise.resolve(latest.current.data) : reload());

  /** Installs under `key`: the toolbar's, or an Available card's {@link installKey} */
  const install = async (uri: string, key: string) => {
    // Reloads itself so the message can name the libraries by the new lists
    const r = await run(
      key,
      "available",
      async () => ({
        ...(await backend.installLibrary(uri)),
        lists: await reload(),
      }),
      { refresh: false },
    );
    if (r.ok && r.data.requirements.length > 0) {
      const { installed } = r.data.lists;
      setInfo(
        "available",
        installedWithMessage(r.data, (n) => displayName(installed, n)),
      );
    }
    return r;
  };

  const installPlug = (uri: string, path: string) =>
    run(BUSY.install, "available", () => backend.installPlug(uri, path));

  const addRepository = (uri: string, page: string) =>
    run(BUSY.addRepository, "repositories", () =>
      backend.addRepository(uri, page),
    );

  // Only reads: the lists stay as they are
  const checkUpdates = async () => {
    const r = await run(BUSY.check, "installed", backend.checkUpdates, {
      refresh: false,
    });
    if (r.ok) dispatch({ type: "checked", checks: r.data, at: Date.now() });
  };

  const updateLibrary = (lib: { name: string; uri: string }, force = false) =>
    run(rowKey({ kind: "library", name: lib.name }), "installed", () =>
      backend.updateLibrary(lib, force),
    );

  const updateAll = () =>
    updateAllLibraries(
      { ensureLoaded, update: updateLibrary, dispatch, setError, setInfo },
      updating.current,
    );

  const updateAllRepositories = async () => {
    const r = await run(
      BUSY.updateAllRepositories,
      "repositories",
      backend.updateAllRepositories,
    );
    if (!r.ok) return;
    const { updated, errors } = r.data;
    dispatch({ type: "unchecked", names: updated });
    if (errors.length > 0) setError("repositories", errors.join("; "));
    setInfo(
      "repositories",
      updated.length === 0
        ? "All repositories already up to date"
        : `Updated ${plural(updated.length, "repository", "repositories")}: ${updated.join(", ")}`,
    );
  };

  /** Updates one library or repository, saying whether anything changed. */
  const updateOne = async (row: LibraryRow) => {
    const r =
      row.kind === "repository"
        ? await run(rowKey(row), "repositories", () =>
            backend.updateRepository(row.name),
          )
        : await updateLibrary({ name: row.name, uri: row.uri! });
    if (r.ok) {
      dispatch({ type: "unchecked", names: [row.name] });
      setInfo(
        rowSection(row),
        r.data.changed
          ? `Updated ${row.name}`
          : `${row.name} is already up to date`,
      );
    }
  };

  /** Reinstalls a library from its source, dropping local edits. */
  const revertOne = async (row: LibraryRow) => {
    const r = await updateLibrary({ name: row.name, uri: row.uri! }, true);
    if (r.ok) {
      dispatch({ type: "unchecked", names: [row.name] });
      setInfo("installed", `Reverted ${row.name}`);
    }
  };

  const removeOne = async (row: LibraryRow) => {
    const r = await run(rowKey(row), rowSection(row), () =>
      KINDS[row.kind].remove(row.name),
    );
    if (r.ok) dispatch({ type: "unchecked", names: [row.name] });
  };

  return {
    state,
    writable,
    isBusy: (key: string) => state.busy.has(key),
    setError,
    setInfo,
    reload,
    ensureLoaded,
    install,
    installPlug,
    addRepository,
    checkUpdates,
    updateAll,
    updateAllRepositories,
    updateOne,
    revertOne,
    removeOne,
  };
}

export type Libraries = ReturnType<typeof useLibraries>;
