import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { ToolFence } from "@silverbulletmd/silverbullet/lib/tool_pages";
import type { Client } from "../../client.ts";
import type { WidgetActionId } from "../../codemirror/widgets/widget_menu.ts";
import {
  blockRank,
  blockSourceRef,
  currentBlockStart,
  type SpaceBlock,
} from "./blocks.ts";
import { scriptRefParts } from "./source_frames.ts";

/**
 * A ⋯ menu item. It acts through `deps`, which the tab supplies, so the
 * lists of actions stay testable without a client.
 */
export type Action<Deps> = {
  label: string;
  icon: WidgetActionId;
  run: (deps: Deps) => Promise<void>;
  /** Why it can't run now: shown grayed out with this as its tooltip */
  disabled?: string;
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

/**
 * Opens a listed block's code. The ref's offset is from the last load, so the
 * block is found in the page as it is now: the open editor's text when it
 * shows that page, unsaved edits included, else the stored page. `loaded`:
 * every block of that kind from the same load, to tell where `block` stood
 * among its page's blocks.
 */
export async function openBlockSource(
  client: Client,
  block: { ref: string; source: string },
  fence: ToolFence,
  loaded: SpaceBlock[],
): Promise<void> {
  const target = blockSourceRef(block.ref, fence);
  if (!target) return;
  const { page, pos } = scriptRefParts(block.ref);
  if (pos !== undefined) {
    try {
      const text =
        client.currentName() === page
          ? client.editorView.state.sliceDoc()
          : (await client.space.readPage(page)).text;
      const at = currentBlockStart(
        text,
        fence,
        block.source,
        pos,
        blockRank(loaded, block.ref),
      );
      if (at !== undefined) target.details = { type: "position", pos: at };
    } catch (e) {
      // Unreadable or gone: open the recorded spot
      console.warn("Could not locate block", block.ref, e);
    }
  }
  await openRef(client, target);
}
