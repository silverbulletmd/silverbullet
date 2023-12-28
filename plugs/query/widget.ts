import { codeWidget, editor } from "$sb/syscalls.ts";

export function refreshAllWidgets() {
  codeWidget.refreshAll();
}

export async function editButton(pos: number) {
  await editor.moveCursor(pos);
}
