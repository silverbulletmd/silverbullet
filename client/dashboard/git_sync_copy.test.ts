import { expect, test } from "vitest";
import {
  COULD_NOT_CHECK_FIRST_SYNC,
  describeFirstSyncConfirm,
  describeTestResult,
  firstSyncPrompt,
  isFirstSyncSave,
  GIT_SYNC_MODES,
  needsFirstSyncConfirm,
} from "./git_sync_copy.ts";

test("GIT_SYNC_MODES: exactly the three server modes, Off first so it reads as the default", () => {
  expect(GIT_SYNC_MODES.map((m) => m.value)).toEqual(["off", "key", "manual"]);
});

test("describeTestResult: ok is a plain success line, ignoring the message", () => {
  expect(describeTestResult("ok", "reachable and writable")).toEqual({
    variant: "ok",
    text: "Reachable and writable.",
  });
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

test("describeFirstSyncConfirm: falls back to a generic target when remote or branch is missing", () => {
  expect(describeFirstSyncConfirm(2, null, "main")).toBe(
    "2 local commits will be pushed to the remote. Continue?",
  );
  expect(describeFirstSyncConfirm(2, "origin", null)).toBe(
    "2 local commits will be pushed to the remote. Continue?",
  );
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
