import { syscall } from "./lib/syscall";

export async function commit() {
  console.log("Snapshotting the current space to git");
  await syscall("shell.run", "git", ["add", "./*.md"]);
  try {
    await syscall("shell.run", "git", ["commit", "-a", "-m", "Snapshot"]);
  } catch (e) {
    // We can ignore, this happens when there's no changes to commit
  }
  console.log("Done!");
}
