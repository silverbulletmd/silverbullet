import {
  editor,
  shell,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { EditorGutterMarker } from "@silverbulletmd/silverbullet/type/client";

const GUTTER_ID = "git-blame";
const GUTTER_WIDTH = 18;
// Number of distinct committer colors the stylesheet defines
// (`.git-blame-author-0` … see `client/styles/editor.scss`).
const AUTHOR_COLOR_COUNT = 10;
// Opt-in: this plug shells out to `git blame` for every page load, which is
// only wanted in a space that is actually a Git working copy.
const ENABLED_CONFIG_KEY = "gitBlame.enabled";

let refreshToken = 0;

type BlameLine = {
  rev?: string;
  revisionLine: number;
  line: number;
  author: string;
  committer: string;
  authorTime?: string;
  committerTime?: string;
  summary: string;
};

/** Parse current and committed-revision line numbers from Git's porcelain format. */
export function parseGitBlame(output: string): EditorGutterMarker[] {
  const markers: EditorGutterMarker[] = [];
  let current: BlameLine | undefined;

  for (const line of output.split(/\r?\n/)) {
    const header = line.match(
      /^\^?([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+\d+)?$/i,
    );
    if (header) {
      const revisionLine = Number(header[2]);
      const lineNumber = Number(header[3]);
      current =
        Number.isSafeInteger(revisionLine) &&
        revisionLine > 0 &&
        Number.isSafeInteger(lineNumber) &&
        lineNumber > 0
          ? {
              rev: normalizeRevision(header[1]),
              revisionLine,
              line: lineNumber,
              author: "",
              committer: "",
              summary: "",
            }
          : undefined;
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("author ")) {
      current.author = line.slice("author ".length);
    } else if (line.startsWith("committer ")) {
      current.committer = line.slice("committer ".length);
    } else if (line.startsWith("author-time ")) {
      current.authorTime = line.slice("author-time ".length);
    } else if (line.startsWith("committer-time ")) {
      current.committerTime = line.slice("committer-time ".length);
    } else if (line.startsWith("summary ")) {
      current.summary = line.slice("summary ".length);
    } else if (line.startsWith("\t")) {
      const author = current.author.trim();
      const committer = current.committer.trim();
      const displayName = committer || author || "unknown";
      const date = formatDate(current.committerTime ?? current.authorTime);
      const summary = current.summary.trim();
      const title = [
        displayName,
        author && author !== displayName ? `author: ${author}` : undefined,
        date,
        summary,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" - ");

      markers.push({
        line: current.line,
        text: current.rev ? displayName : "working",
        title: title || displayName,
        className: `git-blame-author-${authorColor(displayName)}`,
        rev: current.rev,
        revisionLine: current.rev ? current.revisionLine : current.line,
      });
      current = undefined;
    }
  }

  return markers;
}

function normalizeRevision(revision: string): string | undefined {
  const normalized = revision.toLowerCase();
  return /^0+$/.test(normalized) ? undefined : normalized;
}

function authorColor(author: string): number {
  let hash = 0;
  for (const character of author) {
    hash = (hash * 31 + character.codePointAt(0)!) | 0;
  }
  return (hash >>> 0) % AUTHOR_COLOR_COUNT;
}

function formatDate(epochSeconds: string | undefined): string | undefined {
  if (!epochSeconds) {
    return undefined;
  }

  const timestamp = Number(epochSeconds);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString().slice(0, 10);
}

async function isCurrentPage(
  pageName: string,
  token: number,
): Promise<boolean> {
  if (token !== refreshToken) {
    return false;
  }
  return (await editor.getCurrentPage()) === pageName && token === refreshToken;
}

async function clearBlame(pageName: string, token: number): Promise<void> {
  if (token === refreshToken) {
    await editor.clearGutter(GUTTER_ID, pageName);
  }
}

/** Refresh blame after navigation, reload, save, or plug startup. */
export async function refreshGitBlame(eventPageName?: string): Promise<void> {
  const token = ++refreshToken;
  let pageName = eventPageName;

  try {
    if ((await system.getConfig<boolean>(ENABLED_CONFIG_KEY, false)) !== true) {
      return;
    }

    pageName ??= await editor.getCurrentPage();
    if (!pageName || !(await isCurrentPage(pageName, token))) {
      return;
    }

    if ((await editor.getCurrentEditor()) !== "page") {
      await clearBlame(pageName, token);
      return;
    }

    const currentPath = await editor.getCurrentPath();
    if (token !== refreshToken || !currentPath.toLowerCase().endsWith(".md")) {
      await clearBlame(pageName, token);
      return;
    }

    // Virtual pages have no corresponding file and therefore no Git history.
    try {
      await space.getPageMeta(pageName);
    } catch {
      await clearBlame(pageName, token);
      return;
    }

    if (!(await isCurrentPage(pageName, token))) {
      return;
    }
    await editor.clearGutter(GUTTER_ID, pageName);

    if (!(await isCurrentPage(pageName, token))) {
      return;
    }
    const result = await shell.run("git", [
      "blame",
      "--line-porcelain",
      "--",
      `${pageName}.md`,
    ]);

    if (!(await isCurrentPage(pageName, token))) {
      return;
    }

    if (result.code !== 0) {
      // Not a Git working copy, no history for this page yet, or shell access
      // is disabled — all normal; the gutter simply stays empty.
      await clearBlame(pageName, token);
      return;
    }

    await editor.setGutter(GUTTER_ID, {
      page: pageName,
      width: GUTTER_WIDTH,
      className: "git-blame-gutter",
      markers: parseGitBlame(result.stdout),
    });
  } catch (error) {
    if (pageName) {
      await clearBlame(pageName, token).catch(() => {});
    }
    console.warn("[git-blame] failed to refresh", error);
  }
}
