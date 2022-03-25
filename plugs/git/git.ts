import { syscall } from "../lib/syscall";

export async function commit(message?: string) {
  if (!message) {
    message = "Snapshot";
  }
  console.log(
    "Snapshotting the current space to git with commit message",
    message
  );
  await syscall("shell.run", "git", ["add", "./*.md"]);
  try {
    await syscall("shell.run", "git", ["commit", "-a", "-m", message]);
  } catch (e) {
    // We can ignore, this happens when there's no changes to commit
  }
  console.log("Done!");
}

export async function snapshotCommand() {
  let revName = await syscall("editor.prompt", `Revision name:`);
  if (!revName) {
    revName = "Snapshot";
  }
  console.log("Revision name", revName);
  await syscall("system.invokeFunctionOnServer", "commit", revName);
}

export async function syncCommand() {
  await syscall("system.invokeFunctionOnServer", "sync");
}

export async function sync() {
  console.log("Going to sync with git");
  console.log("First locally committing everything");
  await commit();
  console.log("Then pulling from remote");
  await syscall("shell.run", "git", ["pull"]);
  console.log("And then pushing to remote");
  await syscall("shell.run", "git", ["push"]);
  console.log("Done!");
}
