import { editor } from "@silverbulletmd/silverbullet/syscalls";
import {
  indent as indentOp,
  moveDown as moveDownOp,
  moveUp as moveUpOp,
  outdent as outdentOp,
} from "./outline_ops.ts";

async function applyOutlineOp(
  op: (
    text: string,
    cursor: number,
  ) => { text: string; cursor: number } | "blocked" | null,
  fallback?: () => void,
) {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();
  const result = op(text, cursorPos);
  if (result === "blocked") {
    await editor.flashNotification("Cannot move item further", "error");
    return;
  }
  if (result === null) {
    if (fallback) {
      fallback();
    }
    return;
  }

  await editor.setText(result.text, true);
  await editor.moveCursor(result.cursor);
}

export async function moveItemUp() {
  await applyOutlineOp(moveUpOp, () => editor.moveLineUp());
}

export async function moveItemDown() {
  await applyOutlineOp(moveDownOp, () => editor.moveLineDown());
}

export async function indentItem() {
  await applyOutlineOp(indentOp);
}

export async function outdentItem() {
  await applyOutlineOp(outdentOp);
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
