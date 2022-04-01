import { insertAtCursor } from "plugos-silverbullet-syscall/editor";

export async function insertToday() {
  let niceDate = new Date().toISOString().split("T")[0];
  await insertAtCursor(niceDate);
}
