import { syscall } from "./lib/syscall";

export async function insertToday() {
  console.log("Inserting date");
  let niceDate = new Date().toISOString().split("T")[0];
  await syscall("editor.insertAtCursor", niceDate);
}
