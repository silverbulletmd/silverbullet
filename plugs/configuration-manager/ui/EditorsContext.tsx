import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ConfigEditor } from "./useConfigEditor.ts";
import type { ShortcutEditor } from "./useShortcutEditor.ts";

export type EditorsValue = {
  config: ConfigEditor;
  shortcuts: ShortcutEditor;
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
