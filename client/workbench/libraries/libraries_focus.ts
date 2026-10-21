/**
 * What a `Library: …` command wants the Libraries tab to do once it shows.
 * The command may run while the Workbench is closed, so the request waits
 * here until the tab takes it.
 */
export type LibrariesFocus =
  | "manager"
  | "install"
  | "addRepository"
  | "updateAll"
  | "updateAllRepositories";

let pending: LibrariesFocus | undefined;
const listeners = new Set<() => void>();

export function requestLibrariesFocus(focus: LibrariesFocus): void {
  pending = focus;
  for (const listener of [...listeners]) listener();
}

/** The pending request, once. */
export function takeLibrariesFocus(): LibrariesFocus | undefined {
  const focus = pending;
  pending = undefined;
  return focus;
}

export function onLibrariesFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
