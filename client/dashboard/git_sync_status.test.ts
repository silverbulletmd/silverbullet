import { expect, test } from "vitest";
import { syncStatusText } from "../sync_notification.ts";
import { describeSyncError } from "./git_sync_copy.ts";
import {
  gitProblemText,
  gitStateLabel,
  gitStatusText,
  gitSyncsWith,
} from "./git_sync_status.ts";
import type { GitStatus, SpaceInfo } from "./types.ts";

function space(overrides: Partial<SpaceInfo>): SpaceInfo {
  return { name: "Notes", revisions: "managed", ...overrides } as SpaceInfo;
}

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    remoteUrl: "git@example.test:notes.git",
    remoteName: "origin",
    branch: "main",
    remoteBranch: "main",
    credentialMode: "key",
    publicKey: null,
    fingerprint: null,
    ahead: 0,
    behind: 0,
    sync: { state: "idle" },
    lastSuccess: 1_700_000_000_000,
    lastAttempt: 1_700_000_000_000,
    version: 1,
    enabled: true,
    paused: false,
    ...overrides,
  } as GitStatus;
}

test("only managed spaces with a git remote mode sync with git", () => {
  const sync = (mode: "off" | "key" | "manual") => ({
    mode,
    pullIntervalSecs: 60,
  });
  expect(gitSyncsWith(space({ gitSync: sync("key") }))).toBe(true);
  expect(gitSyncsWith(space({ gitSync: sync("manual") }))).toBe(true);
  expect(gitSyncsWith(space({ gitSync: sync("off") }))).toBe(false);
  expect(gitSyncsWith(space({}))).toBe(false);
  expect(
    gitSyncsWith(space({ revisions: "unmanaged", gitSync: sync("key") })),
  ).toBe(false);
});

test("an up-to-date space reads the same as on its git page", () => {
  const value = status();
  expect(gitStatusText(value)).toBe(
    syncStatusText({
      sync: value.sync,
      enabled: true,
      paused: false,
      lastSuccess: value.lastSuccess ?? null,
      lastAttempt: value.lastAttempt ?? null,
      version: 1,
      pending: 0,
      incoming: 0,
      dirty: undefined,
    } as any),
  );
  expect(gitStatusText(value)).toMatch(/^Up to date/);
});

test("an error is explained the way the git page explains it", () => {
  const failing = status({
    sync: { state: "error", kind: "auth", message: "Permission denied" },
  });
  expect(gitStatusText(failing)).toBe("Sync needs attention");
  expect(gitProblemText(failing)).toBe(
    describeSyncError("auth", "Permission denied"),
  );
  expect(gitProblemText(status())).toBeNull();
});

test("the overview's state label leaves time and counts to their columns", () => {
  expect(gitStateLabel(status())).toBe("Up to date");
  expect(gitStatusText(status())).toMatch(/^Up to date — ./);
  expect(gitStateLabel(status({ ahead: 2 }))).toBe("Changes waiting");
  expect(gitStatusText(status({ ahead: 2 }))).toBe(
    "Changes waiting — 2 outgoing, 0 incoming",
  );
  expect(gitStateLabel(status({ lastSuccess: null } as any))).toBe(
    "Waiting for the first successful sync",
  );
  expect(gitStateLabel(status({ paused: true }))).toBe("Sync paused");
  expect(gitStateLabel(status({ enabled: false }))).toBe("Disconnected");
  expect(
    gitStateLabel(status({ enabled: undefined, credentialMode: "off" } as any)),
  ).toBe("Disconnected");
});
