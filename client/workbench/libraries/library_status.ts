/** Maps a library's update-check state to the label and tone shown beside it. */
import type { LibraryCheck } from "./libraries_backend.ts";

export type LibraryStatus = {
  label: string;
  tone: "ok" | "update" | "warn" | "error";
  title?: string;
};

export function libraryStatusLabel(
  check: LibraryCheck | undefined,
): LibraryStatus | undefined {
  if (!check) return undefined;
  switch (check.state) {
    case "upToDate":
      return { label: "up to date", tone: "ok" };
    case "remoteChanged":
    case "differs":
      return { label: "update available", tone: "update" };
    case "bothChanged":
      return { label: "update available, changed locally", tone: "warn" };
    case "localChanged":
      return { label: "changed locally", tone: "warn" };
    case "missing":
      return { label: "missing on remote", tone: "error" };
    case "error":
      return { label: "check failed", tone: "error", title: check.error };
  }
}
