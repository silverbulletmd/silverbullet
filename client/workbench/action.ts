import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "../client.ts";
import type { WidgetActionId } from "../codemirror/widgets/widget_menu.ts";

/**
 * A ⋯ menu item. It acts through `deps`, which the tab supplies, so the
 * lists of actions stay testable without a client.
 */
export type Action<Deps> = {
  label: string;
  icon: WidgetActionId;
  run: (deps: Deps) => Promise<void>;
};

export async function copyText(client: Client, text: string): Promise<void> {
  await client.clientSystem.localSyscall("editor.copyToClipboard", [text]);
  client.ui.flashNotification("Copied");
}

/** Opens `ref` in the editor and hands it focus. */
export async function openRef(client: Client, ref: Ref): Promise<void> {
  await client.navigate(ref);
  client.focus();
}
