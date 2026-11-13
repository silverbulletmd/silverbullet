import type { ThemeInfo } from "@silverbulletmd/silverbullet/lib/themes";
import { collectTooling, type ToolBlock, type ToolingFile } from "./tooling.ts";

export type Tooling = {
  scripts: ToolBlock[];
  styles: ToolBlock[];
  themeStyles: ToolBlock[];
  themes: ThemeInfo[];
  files: ToolingFile[];
};

/**
 * Fetches every Tool Page from `/.tooling` (relative to the space's base URL)
 * and collects their scripts and styles in load order.
 */
export async function fetchTooling(
  fetchFn: typeof fetch,
  timeoutMs = 10000,
): Promise<Tooling> {
  // A proxy that accepts the connection and then hangs must not stall boot
  const response = await fetchFn(".tooling", {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch tooling: HTTP ${response.status}`);
  }
  const files: ToolingFile[] = await response.json();
  return { ...collectTooling(files), files };
}

/** Keeps the last good `/.tooling` payload for boots that can't fetch it. */
export type ToolingCache = {
  read(): Promise<ToolingFile[] | undefined>;
  write(files: ToolingFile[]): Promise<void>;
};

/**
 * Boot's tooling, from its fetch of `/.tooling`: a good payload is kept in
 * `cache` for boots that can't fetch it, a failed fetch falls back to that
 * copy. A cold service worker isn't configured yet and passes `/.tooling` to
 * the server, so offline or with the server down boot needs the copy, which
 * misses Tool Page edits not yet synced; they load on the next reload after
 * sync. With neither, boot carries on without scripts or styles.
 */
export async function resolveBootTooling(
  fetched: Tooling | Error,
  cache: ToolingCache | undefined,
): Promise<Tooling | undefined> {
  if (!(fetched instanceof Error)) {
    cache?.write(fetched.files).catch((e) => {
      console.warn("Could not cache tool pages:", e);
    });
    return fetched;
  }
  const files = await cache?.read().catch(() => undefined);
  if (files) {
    console.warn(
      "Could not fetch tool pages, booting from cached copy:",
      fetched,
    );
    return { ...collectTooling(files), files };
  }
  console.error(
    "Could not fetch tool pages, booting without space scripts and styles:",
    fetched,
  );
  return undefined;
}
