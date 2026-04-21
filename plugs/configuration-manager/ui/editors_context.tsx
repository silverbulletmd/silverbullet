import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ConfigEditor } from "./use_config_editor.ts";
import type { ShortcutEditor } from "./use_shortcut_editor.ts";
import type { LibrariesEditor } from "./use_libraries_editor.ts";

export type EditorsValue = {
  config: ConfigEditor;
  shortcuts: ShortcutEditor;
  libraries: LibrariesEditor;
};

export const EditorsContext = createContext<EditorsValue | null>(null);

export function useConfig(): ConfigEditor {
  const v = useContext(EditorsContext);
  if (!v) throw new Error("EditorsContext not provided");
  return v.config;
}

export function useShortcuts(): ShortcutEditor {
  const v = useContext(EditorsContext);
  if (!v) throw new Error("EditorsContext not provided");
  return v.shortcuts;
}

export function useLibraries(): LibrariesEditor {
  const v = useContext(EditorsContext);
  if (!v) throw new Error("EditorsContext not provided");
  return v.libraries;
}
