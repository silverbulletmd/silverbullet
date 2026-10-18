import { editor } from "@silverbulletmd/silverbullet/syscalls";
import type { RootViewModel } from "../src/model.ts";

declare const __GRAPH: RootViewModel;

// Where the client shows this panel (one per iframe), set before it boots
const docked = __GRAPH.dock !== "modal";

/**
 * Opens `ref` in the editor. The modal closes to show it; a docked graph stays
 * beside the editor.
 */
export async function openInEditor(ref: string): Promise<void> {
  await editor.navigate(ref);
  if (!docked) await editor.hidePanel("modal");
}

/** Escape: closes the modal, or returns from a docked graph to the editor */
export async function dismiss(): Promise<void> {
  if (docked) await editor.focus();
  else await editor.hidePanel("modal");
}
