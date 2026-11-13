import { editor, markdown } from "@silverbulletmd/silverbullet/syscalls";
import {
  indent,
  moveDown,
  moveUp,
  type OutlineOp,
  outdent,
} from "./outline_ops.ts";

/**
 * Runs an outline op on the selection (a collapsed one is the cursor),
 * keeping it, or `fallback` when nothing outline-like is there.
 */
async function applyOutlineOp(op: OutlineOp, fallback?: () => void) {
  const [{ from, to }, text] = await Promise.all([
    editor.getSelection(),
    editor.getText(),
  ]);
  const result = op(text, await markdown.parseMarkdown(text), from, to);
  if (result === "blocked") {
    await editor.flashNotification("Cannot move item further", "error");
  } else if (result === null) {
    fallback?.();
  } else {
    await editor.setText(result.text, true);
    if (result.from === result.to) {
      // Scrolls the cursor into view, as a cursor-only op always has
      await editor.moveCursor(result.from);
    } else {
      await editor.setSelection(result.from, result.to);
    }
  }
}

export async function moveItemUp() {
  await applyOutlineOp(moveUp, () => editor.moveLineUp());
}

export async function moveItemDown() {
  await applyOutlineOp(moveDown, () => editor.moveLineDown());
}

export async function indentItem() {
  await applyOutlineOp(indent);
}

export async function outdentItem() {
  await applyOutlineOp(outdent);
}

export async function foldCommand() {
  await editor.fold();
}

export async function unfoldCommand() {
  await editor.unfold();
}

export async function toggleFoldCommand() {
  await editor.toggleFold();
}

export async function foldAllCommand() {
  await editor.foldAll();
}

export async function unfoldAllCommand() {
  await editor.unfoldAll();
}
