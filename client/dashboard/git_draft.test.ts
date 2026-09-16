import { expect, test } from "vitest";
import { GitDraftSession } from "./git_draft.ts";
import type { GitDraft } from "./types.ts";

const draft: GitDraft = {
  id: "draft-1",
  version: 1,
  url: "git@example.org:team/notes.git",
  mode: "key",
  pullIntervalSecs: 300,
  publicKey: "ssh-ed25519 sample",
  fingerprint: "SHA256:sample",
};
const checked = {
  reachable: true,
  writable: true,
  kind: "ok" as const,
  message: "",
  checkedUrl: draft.url,
  checkedAt: 123,
  unrelated: false,
};

test("editing a checked draft immediately removes activation eligibility", () => {
  const session = new GitDraftSession({ ...draft, test: checked });
  expect(session.canApply).toBe(true);
  session.edit({ url: "git@example.org:team/other.git" });
  expect(session.value.test).toBeUndefined();
  expect(session.canApply).toBe(false);
});

test("an older check cannot overwrite a newer edit", async () => {
  const session = new GitDraftSession(draft);
  let finish!: (value: GitDraft) => void;
  const pending = session.run(
    () =>
      new Promise<GitDraft>((resolve) => {
        finish = resolve;
      }),
  );
  session.edit({ mode: "manual" });
  finish({ ...draft, version: 2, test: checked });
  await pending;
  expect(session.value.mode).toBe("manual");
  expect(session.value.version).toBe(2);
  expect(session.value.test).toBeUndefined();
  expect(session.canApply).toBe(false);
});

test("cancelled draft ignores a late successful check", async () => {
  const session = new GitDraftSession(draft);
  let finish!: (value: GitDraft) => void;
  const pending = session.run(
    () =>
      new Promise<GitDraft>((resolve) => {
        finish = resolve;
      }),
  );
  session.discard();
  finish({ ...draft, version: 2, test: checked });
  await pending;
  expect(session.canApply).toBe(false);
  expect(session.value.test).toBeUndefined();
});

test("a failed preflight cannot enable sync", () => {
  const session = new GitDraftSession({
    ...draft,
    test: { ...checked, reachable: false, writable: false, kind: "authFailed" },
  });
  expect(session.canApply).toBe(false);
});

test("an inconclusive empty-branch preflight can proceed with its limitation", () => {
  const session = new GitDraftSession({
    ...draft,
    test: { ...checked, kind: "emptyRepo", writable: false },
  });
  expect(session.canApply).toBe(true);
});

test("pending changes compare connection settings to the initial draft", async () => {
  const session = new GitDraftSession(draft);
  expect(session.changed).toBe(false);
  await session.run(async (value) => ({ ...value, version: 2, test: checked }));
  expect(session.changed).toBe(false);
  session.edit({ url: "git@example.org:team/other.git" });
  expect(session.changed).toBe(true);
  await session.run(async (value) => ({ ...value, version: 3 }));
  expect(session.changed).toBe(true);
  session.edit({ url: draft.url });
  expect(session.changed).toBe(false);
  session.edit({ pullIntervalSecs: 60 });
  expect(session.changed).toBe(true);
});

test("generating a replacement key is a pending connection change", async () => {
  const session = new GitDraftSession(draft);
  await session.run(async (value) => ({
    ...value,
    publicKey: "ssh-ed25519 replacement",
    fingerprint: "SHA256:replacement",
  }));
  expect(session.changed).toBe(true);
});
