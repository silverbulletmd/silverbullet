import { useCallback, useState } from "preact/hooks";
import { useCfg } from "./cfg_context.tsx";
import type { OverrideChanges } from "../overrides.ts";
import { configChanges, getSchemaAtPath } from "./schema.ts";

export type ConfigEditor = {
  pendingConfig: Record<string, any>;
  setField(path: string, value: any): void;
  resetField(path: string): void;
  isModified(path: string): boolean;
  changes(): OverrideChanges<unknown>;
};

export function useConfigEditor(): ConfigEditor {
  const { cfg, schemaIndex } = useCfg();
  const [pendingConfig, setPendingConfig] = useState<Record<string, any>>(
    () => ({ ...schemaIndex.initialConfig }),
  );
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(
    () => new Set(schemaIndex.initialModifiedPaths),
  );

  const setField = useCallback(
    (path: string, value: any) => {
      setPendingConfig((prev) => {
        if (prev[path] === value) return prev;
        return { ...prev, [path]: value };
      });
      setModifiedPaths((prev) => {
        const schema = getSchemaAtPath(cfg.schemas, path);
        const def = schema?.default;
        const normDef = schema?.type === "boolean" && def == null ? false : def;
        const normCur =
          schema?.type === "boolean" && value == null ? false : value;
        const next = new Set(prev);
        if (normCur === normDef) next.delete(path);
        else next.add(path);
        // Preserve identity if nothing changed.
        if (next.size === prev.size && [...next].every((p) => prev.has(p))) {
          return prev;
        }
        return next;
      });
    },
    [cfg.schemas],
  );

  const resetField = useCallback(
    (path: string) => {
      const schema = getSchemaAtPath(cfg.schemas, path);
      setPendingConfig((prev) => ({ ...prev, [path]: schema?.default }));
      setModifiedPaths((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    },
    [cfg.schemas],
  );

  const isModified = useCallback(
    (path: string) => modifiedPaths.has(path),
    [modifiedPaths],
  );

  const changes = useCallback(
    () => configChanges(cfg.configOverrides, modifiedPaths, pendingConfig),
    [cfg.configOverrides, modifiedPaths, pendingConfig],
  );

  return { pendingConfig, setField, resetField, isModified, changes };
}
