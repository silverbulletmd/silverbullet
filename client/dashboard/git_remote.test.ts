import { expect, test } from "vitest";
import { parseRepoUrl } from "./git_remote.ts";

test.each([
  ["https://github.com/acme/handbook", "git@github.com:acme/handbook.git"],
  ["https://github.com/acme/handbook/", "git@github.com:acme/handbook.git"],
  ["https://github.com/acme/handbook.git", "git@github.com:acme/handbook.git"],
  ["https://www.github.com/acme/handbook", "git@github.com:acme/handbook.git"],
  [
    "https://github.com/acme/handbook/tree/main/docs",
    "git@github.com:acme/handbook.git",
  ],
  [
    "https://github.com/acme/handbook/blob/main/a.md",
    "git@github.com:acme/handbook.git",
  ],
  [
    "https://github.com/acme/handbook?tab=readme",
    "git@github.com:acme/handbook.git",
  ],
  ["git@github.com:acme/handbook.git", "git@github.com:acme/handbook.git"],
  [
    "ssh://git@github.com/acme/handbook.git",
    "git@github.com:acme/handbook.git",
  ],
  ["  https://github.com/acme/handbook  ", "git@github.com:acme/handbook.git"],
])("parseRepoUrl normalizes %s", (input, expected) => {
  expect(parseRepoUrl(input)?.sshUrl).toBe(expected);
});

test("parseRepoUrl keeps GitLab nested subgroups and strips the /-/ tail", () => {
  const r = parseRepoUrl(
    "https://gitlab.com/team/sub/group/handbook/-/tree/main",
  );
  expect(r?.sshUrl).toBe("git@gitlab.com:team/sub/group/handbook.git");
  expect(r?.provider).toBe("gitlab");
});

test("parseRepoUrl derives the deploy-key page per provider", () => {
  expect(parseRepoUrl("https://github.com/acme/handbook")?.deployKeyUrl).toBe(
    "https://github.com/acme/handbook/settings/keys/new",
  );
  expect(parseRepoUrl("https://gitlab.com/acme/handbook")?.deployKeyUrl).toBe(
    "https://gitlab.com/acme/handbook/-/settings/repository",
  );
  expect(parseRepoUrl("https://codeberg.org/acme/handbook")?.deployKeyUrl).toBe(
    "https://codeberg.org/acme/handbook/settings/keys",
  );
  expect(
    parseRepoUrl("https://bitbucket.org/acme/handbook")?.deployKeyUrl,
  ).toBe("https://bitbucket.org/acme/handbook/admin/access-keys/");
});

test("parseRepoUrl: an unknown host still normalizes but has no provider or link", () => {
  const r = parseRepoUrl("https://git.example.test/team/handbook");
  expect(r?.sshUrl).toBe("git@git.example.test:team/handbook.git");
  expect(r?.provider).toBe("other");
  expect(r?.deployKeyUrl).toBeUndefined();
});

test("parseRepoUrl: a provider hint supplies the link for an unknown host", () => {
  const r = parseRepoUrl("https://git.example.test/team/handbook", "forgejo");
  expect(r?.deployKeyUrl).toBe(
    "https://git.example.test/team/handbook/settings/keys",
  );
});

test.each([
  "",
  "github.com",
  "https://github.com",
  "https://github.com/acme",
  "not a url at all",
])("parseRepoUrl rejects %s", (input) => {
  expect(parseRepoUrl(input)).toBeNull();
});

test("parseRepoUrl preserves an explicit ssh:// port instead of folding it into the path", () => {
  const r = parseRepoUrl("ssh://git@git.example.com:2222/team/repo.git");
  expect(r?.sshUrl).toBe("ssh://git@git.example.com:2222/team/repo.git");
  expect(r?.path).toBe("team/repo");
});

test("parseRepoUrl: an ssh:// URL with no port still normalizes to the scp form", () => {
  const r = parseRepoUrl("ssh://git@git.example.com/team/repo.git");
  expect(r?.sshUrl).toBe("git@git.example.com:team/repo.git");
});

test("parseRepoUrl: bare scp shorthand with a leading digit segment is left alone (not a port)", () => {
  const r = parseRepoUrl("git@git.example.com:2222/o/r.git");
  expect(r?.sshUrl).toBe("git@git.example.com:2222/o/r.git");
  expect(r?.path).toBe("2222/o/r");
});

test("parseRepoUrl truncates at the last /-/ delimiter, not the first", () => {
  const r = parseRepoUrl("https://gitlab.com/team/-/handbook/-/tree/main");
  expect(r?.sshUrl).toBe("git@gitlab.com:team/-/handbook.git");
});

test("parseRepoUrl lowercases a mixed-case scp host so provider detection still matches", () => {
  const r = parseRepoUrl("git@GitHub.com:acme/handbook.git");
  expect(r?.provider).toBe("github");
  expect(r?.deployKeyUrl).toBe(
    "https://github.com/acme/handbook/settings/keys/new",
  );
});
