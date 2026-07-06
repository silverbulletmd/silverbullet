import { execFile as execFileCb } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const staticDir = "client_bundle/static";

async function git(args: string[], cwd = process.cwd()): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, encoding: "utf-8" });
  return stdout.trim();
}

async function copyStaticFiles(worktreeDir: string): Promise<void> {
  for (const entry of await readdir(worktreeDir)) {
    if (entry === ".git") {
      continue;
    }
    await rm(join(worktreeDir, entry), { recursive: true, force: true });
  }

  for (const entry of await readdir(staticDir)) {
    await cp(join(staticDir, entry), join(worktreeDir, entry), {
      recursive: true,
    });
  }
}

async function deployPages(): Promise<void> {
  const worktreeDir = await mkdtemp(join(tmpdir(), "silverbullet-gh-pages-"));
  let worktreeAdded = false;

  try {
    await git(["fetch", "origin", "gh-pages"]);
    // Reset local gh-pages branch to match remote
    await git(["branch", "-f", "gh-pages", "origin/gh-pages"]);
    await git(["worktree", "add", worktreeDir, "gh-pages"]);
    worktreeAdded = true;

    await copyStaticFiles(worktreeDir);
    await git(["add", "-A"], worktreeDir);

    const status = await git(["status", "--porcelain"], worktreeDir);
    if (!status) {
      console.log("No GitHub Pages changes to deploy.");
      return;
    }

    await git(
      ["commit", "-m", "Deploy static SilverBullet to GitHub Pages"],
      worktreeDir,
    );
    await git(["push", "origin", "gh-pages"], worktreeDir);
    console.log("Deployed static SilverBullet to gh-pages.");
  } finally {
    if (worktreeAdded) {
      await git(["worktree", "remove", "--force", worktreeDir]);
    } else {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  }
}

await deployPages();
