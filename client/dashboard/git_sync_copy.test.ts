import { expect, test } from "vitest";
import {
  COULD_NOT_CHECK_FIRST_SYNC,
  describeFirstSyncConfirm,
  describeGitSyncMode,
  describeSyncError,
  describeTestResult,
  firstSyncPrompt,
  formatDuration,
  isFirstSyncSave,
  GIT_SYNC_MODES,
  needsFirstSyncConfirm,
} from "./git_sync_copy.ts";

test("GIT_SYNC_MODES: exactly the three server modes, Off first so it reads as the default", () => {
  expect(GIT_SYNC_MODES.map((m) => m.value)).toEqual(["off", "key", "manual"]);
});

test("GIT_SYNC_MODES: every mode carries a non-empty label and description", () => {
  for (const mode of GIT_SYNC_MODES) {
    expect(mode.label.length).toBeGreaterThan(0);
    expect(mode.description.length).toBeGreaterThan(0);
  }
});

test("GIT_SYNC_MODES: off says plainly that nothing leaves the server", () => {
  const off = describeGitSyncMode("off");
  expect(off.label).toBe("Off");
  expect(off.description.toLowerCase()).toContain("nothing is pushed");
});

test("GIT_SYNC_MODES: key names SilverBullet as the party managing the key", () => {
  const key = describeGitSyncMode("key");
  expect(key.label).toContain("SilverBullet");
  expect(key.description).toContain("deploy key");
});

test("GIT_SYNC_MODES: manual's label says whose credentials get used, not the word 'ambient'", () => {
  const manual = describeGitSyncMode("manual");
  expect(manual.label).toContain("server's own git credentials");
  expect(manual.label.toLowerCase()).not.toContain("ambient");
  expect(manual.description.toLowerCase()).not.toContain("ambient");
});

test("describeGitSyncMode: an unrecognized mode falls back to Off rather than nothing", () => {
  expect(describeGitSyncMode("something-new" as never)).toBe(GIT_SYNC_MODES[0]);
});

test("describeTestResult: ok is a plain success line, ignoring the message", () => {
  expect(describeTestResult("ok", "reachable and writable")).toEqual({
    variant: "ok",
    text: "Reachable and writable.",
  });
});

test("describeTestResult: emptyRepo is informational, not an error", () => {
  const r = describeTestResult(
    "emptyRepo",
    "Connected. Write access can't be confirmed until this space has something to push.",
  );
  expect(r.variant).toBe("info");
  expect(r.text).toBe(
    "Connected. Write access can't be confirmed until this space has something to push.",
  );
});

test("describeTestResult: behind is a warning, never framed as an auth problem", () => {
  const r = describeTestResult(
    "behind",
    "[rejected] main -> main (non-fast-forward)",
  );
  expect(r.variant).toBe("warning");
  expect(r.text.toLowerCase()).not.toContain("credential");
  expect(r.text.toLowerCase()).not.toContain("auth");
});

test("describeTestResult: authFailed is an error naming write access, appending the server message", () => {
  const r = describeTestResult("authFailed", "permission denied (publickey)");
  expect(r.variant).toBe("error");
  expect(r.text).toBe(
    "Connected, but the credentials don't have write access. permission denied (publickey)",
  );
});

test("describeTestResult: notFound names both a wrong URL and a private repo the key can't see", () => {
  const r = describeTestResult(
    "notFound",
    "does not appear to be a git repository",
  );
  expect(r.variant).toBe("error");
  expect(r.text).toBe(
    "Repository not found — or it's private and the credentials in use don't have access. A wrong URL and missing access look identical from outside. does not appear to be a git repository",
  );
  // Never asserts it's *definitely* a bad URL, and never asserts it's
  // *definitely* a permissions problem — those are indistinguishable from
  // outside, which is the whole point of this copy.
  expect(r.text).toContain("or it's private");
  // Rendered verbatim in manual mode too, where there is no key at all.
  expect(r.text).not.toContain("key");
});

test("describeTestResult: unreachable is an error about the host", () => {
  const r = describeTestResult("unreachable", "Could not resolve hostname");
  expect(r.variant).toBe("error");
  expect(r.text).toBe(
    "Could not reach the remote host. Could not resolve hostname",
  );
});

test("describeTestResult: an unrecognized/other kind falls back to the server message", () => {
  const r = describeTestResult("other" as never, "something else went wrong");
  expect(r.variant).toBe("error");
  expect(r.text).toBe("something else went wrong");
});

test("describeTestResult: empty message on a message-less kind never appends a trailing space", () => {
  expect(describeTestResult("notFound", "").text).toBe(
    "Repository not found — or it's private and the credentials in use don't have access. A wrong URL and missing access look identical from outside.",
  );
  expect(describeTestResult("unreachable", "").text).toBe(
    "Could not reach the remote host.",
  );
});

test("describeSyncError: known kinds get specific copy", () => {
  expect(describeSyncError("HostUnreachable", "")).toBe(
    "Could not reach the remote host.",
  );
  expect(describeSyncError("UnrelatedHistories", "")).toBe(
    "The remote already contains history unrelated to this space.",
  );
});

test("describeSyncError: unknown kinds fall back to the generic line", () => {
  expect(describeSyncError("DetachedHead", "")).toBe(
    "Sync failed — check the space's git settings.",
  );
  expect(describeSyncError("SomeFutureVariant", "")).toBe(
    "Sync failed — check the space's git settings.",
  );
});

test("describeSyncError: appends a message only when it adds information beyond the kind", () => {
  expect(describeSyncError("Other", "disk is full")).toBe(
    "Sync failed — check the space's git settings. (disk is full)",
  );
  // The server never actually sends a message equal to the kind itself
  // (classified variants carry no message at all), but the render must not
  // duplicate it if it ever did.
  expect(describeSyncError("HostUnreachable", "HostUnreachable")).toBe(
    "Could not reach the remote host.",
  );
});

test("formatDuration: renders whole minutes as minutes, everything else as seconds", () => {
  expect(formatDuration(30)).toBe("30s");
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(60)).toBe("1min");
  expect(formatDuration(300)).toBe("5min");
  expect(formatDuration(90)).toBe("90s");
});

test("describeFirstSyncConfirm: singular commit count", () => {
  expect(describeFirstSyncConfirm(1, "origin", "main")).toBe(
    "1 local commit will be pushed to origin/main. Continue?",
  );
});

test("describeFirstSyncConfirm: plural commit count", () => {
  expect(describeFirstSyncConfirm(12, "origin", "main")).toBe(
    "12 local commits will be pushed to origin/main. Continue?",
  );
});

test("describeFirstSyncConfirm: names the actual remote and branch, not a hardcoded origin/main", () => {
  expect(describeFirstSyncConfirm(3, "upstream", "trunk")).toBe(
    "3 local commits will be pushed to upstream/trunk. Continue?",
  );
});

test("describeFirstSyncConfirm: falls back to a generic target when remote or branch is missing", () => {
  expect(describeFirstSyncConfirm(2, null, "main")).toBe(
    "2 local commits will be pushed to the remote. Continue?",
  );
  expect(describeFirstSyncConfirm(2, "origin", null)).toBe(
    "2 local commits will be pushed to the remote. Continue?",
  );
});

test("needsFirstSyncConfirm: a positive count needs confirming", () => {
  expect(needsFirstSyncConfirm(1)).toBe(true);
  expect(needsFirstSyncConfirm(12)).toBe(true);
});

test("needsFirstSyncConfirm: zero and null both pass through silently", () => {
  expect(needsFirstSyncConfirm(0)).toBe(false);
  expect(needsFirstSyncConfirm(null)).toBe(false);
});

test("firstSyncPrompt: no status at all (both the refetch and the cache failed) gets the honest could-not-check prompt", () => {
  expect(firstSyncPrompt(null)).toEqual({
    kind: "unknown",
    message: COULD_NOT_CHECK_FIRST_SYNC,
  });
  expect(COULD_NOT_CHECK_FIRST_SYNC).toContain("Save anyway?");
});

test("firstSyncPrompt: a successful read with a genuinely unknown ahead (no FETCH_HEAD yet) stays silent — this is NOT the same case as no status at all", () => {
  expect(
    firstSyncPrompt({ ahead: null, remoteName: "origin", branch: "main" }),
  ).toEqual({ kind: "none" });
});

test("firstSyncPrompt: a known zero stays silent", () => {
  expect(
    firstSyncPrompt({ ahead: 0, remoteName: "origin", branch: "main" }),
  ).toEqual({ kind: "none" });
});

test("firstSyncPrompt: a known positive count prompts with the commit-count message", () => {
  expect(
    firstSyncPrompt({ ahead: 4, remoteName: "origin", branch: "main" }),
  ).toEqual({
    kind: "count",
    message: describeFirstSyncConfirm(4, "origin", "main"),
  });
});

test("isFirstSyncSave: turning sync on is the transition the confirmation guards", () => {
  expect(isFirstSyncSave("off", "key")).toBe(true);
  expect(isFirstSyncSave("off", "manual")).toBe(true);
  // A space with no gitSync block at all was off.
  expect(isFirstSyncSave(undefined, "key")).toBe(true);
});

test("isFirstSyncSave: a space that is already syncing does not re-confirm on every save", () => {
  // Those commits go out on the next tick whether or not this save happens,
  // so a prompt here guards nothing and trains people to click through it.
  expect(isFirstSyncSave("key", "key")).toBe(false);
  expect(isFirstSyncSave("key", "manual")).toBe(false);
  expect(isFirstSyncSave("manual", "key")).toBe(false);
});

test("isFirstSyncSave: turning sync off, or leaving it off, never prompts", () => {
  expect(isFirstSyncSave("off", "off")).toBe(false);
  expect(isFirstSyncSave("key", "off")).toBe(false);
  expect(isFirstSyncSave(undefined, "off")).toBe(false);
});

test("describeTestResult: sshRequired names both ways out, and never blames credentials", () => {
  const r = describeTestResult(
    "sshRequired",
    "a deploy key … can only authenticate over SSH",
  );
  expect(r.variant).toBe("error");
  // A managed key is an SSH key; GIT_SSH_COMMAND is inert over HTTPS, so this
  // is a transport mismatch, not a permissions problem.
  expect(r.text).toContain("SSH");
  expect(r.text).toContain("Use server credentials");
  expect(r.text.toLowerCase()).not.toContain("write access");
});
