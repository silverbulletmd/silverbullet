import { useCallback, useState } from "preact/hooks";
import * as editor from "../../../plug-api/syscalls/editor.ts";
import * as system from "../../../plug-api/syscalls/system.ts";
import type { ConfigEditor } from "./use_config_editor.ts";
import type { ShortcutEditor } from "./use_shortcut_editor.ts";

export function useSave(config: ConfigEditor, shortcuts: ShortcutEditor) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await system.invokeFunction(
        "configuration-manager.saveConfiguration",
        config.changes(),
        shortcuts.changes(),
      );
      await editor.hidePanel("modal");
      await editor.focus();
    } catch (e: any) {
      console.error("Save failed:", e);
      setError(`Failed to save: ${e.message}`);
      setSaving(false);
    }
  }, [saving, config, shortcuts]);

  const dismissError = useCallback(() => setError(undefined), []);

  return { save, saving, error, dismissError };
}
