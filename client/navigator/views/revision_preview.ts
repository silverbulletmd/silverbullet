import { useEffect, useState } from "preact/hooks";
import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import { editor } from "@silverbulletmd/silverbullet/syscalls";

export type DiffLine = { text: string; cssClass?: string };

export type RevisionPreview = {
  /** A later open supersedes an earlier one; also the component's remount key. */
  token: number;
  path: string;
  /** Unset for the uncommitted pseudo-revision, which cannot be restored. */
  rev?: string;
  header: string;
  message: string;
  /** Unset when the server produced no diff: then there is nothing to toggle. */
  diff?: DiffLine[];
  canRestore: boolean;
  /** A click open takes focus; a spacebar peek leaves it with the dock. */
  focus: boolean;
  /** Where focus returns on close. */
  dock: string;
};

export function diffLineClass(line: string): string | undefined {
  if (line.startsWith("@@")) return "sb-revision-diff-hunk";
  if (line.startsWith("+")) return "sb-revision-diff-add";
  if (line.startsWith("-")) return "sb-revision-diff-del";
  return undefined;
}

export function parseDiff(diff: string): DiffLine[] {
  const lines = diff.replace(/\n$/, "").split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  // The `diff --git`/`index`/`--- a/`/`+++ b/` header lines above the first
  // hunk start with `-`/`+` themselves, so the classifier would otherwise
  // paint them as content changes.
  if (hunkStart === -1) return [{ text: diff }];
  return lines
    .slice(hunkStart)
    .map((text) => ({ text, cssClass: diffLineClass(text) }));
}

export async function restoreInto(path: string, text: string): Promise<void> {
  if ((await editor.getCurrentPath()) !== path) {
    await editor.navigate({ path: path as Path });
    if ((await editor.getCurrentPath()) !== path) {
      throw new Error(`Cannot restore: could not open ${path}.`);
    }
  }
  await editor.setText(text, true);
}

let current: RevisionPreview | undefined;
let nextToken = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

export function openPreview(preview: Omit<RevisionPreview, "token">): void {
  current = { ...preview, token: nextToken++ };
  notify();
}

export function closePreview(): void {
  if (!current) return;
  current = undefined;
  notify();
}

export function currentPreview(): RevisionPreview | undefined {
  return current;
}

export function useRevisionPreview(): RevisionPreview | undefined {
  const [state, setState] = useState(current);
  useEffect(() => {
    setState(current);
    const listener = () => setState(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
