import { useCallback, useState } from "preact/hooks";
import * as system from "../../../plug-api/syscalls/system.ts";
import type {
  InstallableLibrary,
  InstalledLibrary,
  LibrariesViewModel,
  RepositoryInfo,
} from "../libraries.ts";

export type SectionKey = "installed" | "available" | "repositories";

export type LibrariesEditor = {
  data: LibrariesViewModel;
  busy: Set<string>;
  errors: Partial<Record<SectionKey, string>>;
  infos: Partial<Record<SectionKey, string>>;
  isBusy(key: string): boolean;
  setSectionError(section: SectionKey, error?: string): void;
  setSectionInfo(section: SectionKey, info?: string): void;
  run<T = any>(
    key: string,
    section: SectionKey,
    action: string,
    args?: any,
  ): Promise<{ ok: boolean; data?: T; error?: string }>;
  refresh(): Promise<void>;
  updateAllProgress: {
    running: boolean;
    done: number;
    total: number;
    current: string;
  };
  setUpdateAllProgress: (p: {
    running: boolean;
    done: number;
    total: number;
    current: string;
  }) => void;
};

export function useLibrariesEditor(
  initial: LibrariesViewModel,
): LibrariesEditor {
  const [data, setData] = useState<LibrariesViewModel>(initial);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<SectionKey, string>>>({});
  const [infos, setInfos] = useState<Partial<Record<SectionKey, string>>>({});
  const [updateAllProgress, setUpdateAllProgress] = useState({
    running: false,
    done: 0,
    total: 0,
    current: "",
  });

  const refresh = useCallback(async () => {
    const fresh = await system.invokeFunction(
      "configuration-manager.librariesRefresh",
    );
    setData(fresh as LibrariesViewModel);
  }, []);

  const run = useCallback(
    async (
      key: string,
      section: SectionKey,
      action: string,
      args: any = {},
    ) => {
      setBusy((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setErrors((prev) => ({ ...prev, [section]: undefined }));
      setInfos((prev) => ({ ...prev, [section]: undefined }));
      try {
        const result: any = await system.invokeFunction(
          "configuration-manager.librariesAction",
          action,
          args,
        );
        if (!result?.ok) {
          setErrors((prev) => ({
            ...prev,
            [section]: result?.error || "Unknown error",
          }));
          return { ok: false, error: result?.error };
        }
        await refresh();
        return { ok: true, data: result.data };
      } catch (e: any) {
        setErrors((prev) => ({
          ...prev,
          [section]: e?.message || String(e),
        }));
        return { ok: false, error: e?.message };
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [refresh],
  );

  const isBusy = useCallback((key: string) => busy.has(key), [busy]);

  const setSectionError = useCallback((section: SectionKey, error?: string) => {
    setErrors((prev) => ({ ...prev, [section]: error }));
  }, []);

  const setSectionInfo = useCallback((section: SectionKey, info?: string) => {
    setInfos((prev) => ({ ...prev, [section]: info }));
  }, []);

  return {
    data,
    busy,
    errors,
    infos,
    isBusy,
    setSectionError,
    setSectionInfo,
    run,
    refresh,
    updateAllProgress,
    setUpdateAllProgress,
  };
}

export type { InstalledLibrary, InstallableLibrary, RepositoryInfo };
