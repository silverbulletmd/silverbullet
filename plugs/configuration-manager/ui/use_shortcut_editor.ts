import { useCallback, useMemo, useReducer } from "preact/hooks";
import { useCfg } from "./cfg_context.tsx";
import {
  allActiveBindings,
  findConflicts,
  hasAnyConflict,
  manifestBindings,
  overrideBindings,
  resolvedBindings,
  seedOverrideFromManifest,
  writeBindings,
} from "./keys.ts";
import type { Conflicts } from "./keys.ts";
import type { PendingShortcuts } from "./types.ts";

export type ShortcutEditor = {
  pendingShortcuts: PendingShortcuts;
  resolvedBindings(name: string): string[];
  conflictCheck(
    tokens: string[],
    skip: { name: string; slot: number },
  ): Conflicts;
  commit(name: string, slot: number, tokens: string[]): Conflicts | null;
  deleteSlot(name: string, slot: number): void;
  reset(name: string): void;
  isModified(name: string): boolean;
  alternateSlot(name: string): number;
  changes(): PendingShortcuts;
};

type Action =
  | { type: "commit"; name: string; slot: number; tokens: string[] }
  | { type: "deleteSlot"; name: string; slot: number }
  | { type: "reset"; name: string };

function makeReducer(commands: Record<string, any>, isMac: boolean) {
  return (state: PendingShortcuts, action: Action): PendingShortcuts => {
    switch (action.type) {
      case "commit": {
        const binding = action.tokens.join(" ");
        const seeded = seedOverrideFromManifest(
          state,
          action.name,
          commands,
          isMac,
        );
        const list = overrideBindings(seeded[action.name], isMac) ?? [];
        if (action.slot < list.length) list[action.slot] = binding;
        else list.push(binding);
        return writeBindings(seeded, action.name, list, isMac);
      }
      case "deleteSlot": {
        const seeded = seedOverrideFromManifest(
          state,
          action.name,
          commands,
          isMac,
        );
        const list = overrideBindings(seeded[action.name], isMac) ?? [];
        if (action.slot >= list.length) return state;
        list.splice(action.slot, 1);
        return writeBindings(seeded, action.name, list, isMac);
      }
      case "reset": {
        if (!(action.name in state)) return state;
        const next = { ...state };
        delete next[action.name];
        return next;
      }
    }
  };
}

function initialPendingShortcuts(
  commandOverrides: Record<string, any>,
): PendingShortcuts {
  return Object.fromEntries(
    Object.entries(commandOverrides || {}).map(([k, v]) => [k, { ...v }]),
  );
}

export function useShortcutEditor(): ShortcutEditor {
  const { cfg } = useCfg();
  const { commands, isMac } = cfg;

  const reducer = useMemo(
    () => makeReducer(commands, isMac),
    [commands, isMac],
  );
  const [pendingShortcuts, dispatch] = useReducer(
    reducer,
    cfg.commandOverrides,
    initialPendingShortcuts,
  );

  const allActive = useMemo(
    () => allActiveBindings(pendingShortcuts, commands, isMac),
    [pendingShortcuts, commands, isMac],
  );

  const resolved = useCallback(
    (name: string) => resolvedBindings(name, pendingShortcuts, commands, isMac),
    [pendingShortcuts, commands, isMac],
  );

  const conflictCheck = useCallback(
    (tokens: string[], skip: { name: string; slot: number }) =>
      findConflicts(tokens, allActive, skip),
    [allActive],
  );

  const commit = useCallback(
    (name: string, slot: number, tokens: string[]): Conflicts | null => {
      const conflict = findConflicts(tokens, allActive, { name, slot });
      if (hasAnyConflict(conflict)) return conflict;
      dispatch({ type: "commit", name, slot, tokens });
      return null;
    },
    [allActive],
  );

  const deleteSlot = useCallback(
    (name: string, slot: number) =>
      dispatch({ type: "deleteSlot", name, slot }),
    [],
  );

  const reset = useCallback(
    (name: string) => dispatch({ type: "reset", name }),
    [],
  );

  const isModified = useCallback(
    (name: string) => name in pendingShortcuts,
    [pendingShortcuts],
  );

  const alternateSlot = useCallback(
    (name: string) => {
      const override = overrideBindings(pendingShortcuts[name], isMac);
      const list = override ?? manifestBindings(name, commands, isMac);
      return list.length;
    },
    [pendingShortcuts, commands, isMac],
  );

  const changes = useCallback(() => pendingShortcuts, [pendingShortcuts]);

  return {
    pendingShortcuts,
    resolvedBindings: resolved,
    conflictCheck,
    commit,
    deleteSlot,
    reset,
    isModified,
    alternateSlot,
    changes,
  };
}
