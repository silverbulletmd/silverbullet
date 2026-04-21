import { useCallback, useState } from "preact/hooks";
import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import type { ConfigEditor } from "./useConfigEditor.ts";
import type { ShortcutEditor } from "./useShortcutEditor.ts";

export function useSave(config: ConfigEditor, shortcuts: ShortcutEditor) {
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await system.invokeFunction(
        "configuration-manager.saveConfiguration",
        config.changes(),
        shortcuts.changes(),
      );
      await editor.hidePanel("modal");
      await editor.flashNotification("Configuration saved");
    } catch (e: any) {
      console.error("Save failed:", e);
      await editor.flashNotification(`Failed to save: ${e.message}`, "error");
      setSaving(false);
    }
  }, [saving, config, shortcuts]);

  return { save, saving };
}
