import { expect, test, vi } from "vitest";
import { accountsFrom, profileFrom } from "./accounts.ts";
import type { Client } from "./client.ts";

test("a null username stays null: a nameless account addresses nobody", () => {
  const accounts = accountsFrom([
    {
      username: null,
      fullName: "Zef",
      me: true,
    },
  ]);
  expect(accounts).toEqual([{ username: null, fullName: "Zef", me: true }]);
});

test("me defaults to false and blank strings are dropped", () => {
  expect(accountsFrom([{ username: "ada", fullName: "  " }])).toEqual([
    { username: "ada", me: false },
  ]);
});

test("a nameless account still carries the person's identity", () => {
  expect(
    profileFrom([{ username: null, fullName: "Zef Hemel", me: true }]),
  ).toEqual({ username: "me", fullName: "Zef Hemel" });
});

test("a non-array response yields no accounts", () => {
  expect(accountsFrom(null)).toEqual([]);
  expect(accountsFrom({ accounts: [] })).toEqual([]);
});

test("the profile is the entry marked me", () => {
  expect(
    profileFrom([
      { username: "ada", fullName: "Ada Lovelace", me: false },
      { username: "bob", fullName: "Bob", me: true },
    ]),
  ).toEqual({ username: "bob", fullName: "Bob" });
});

test("with nobody marked me, the profile is still a name you can be addressed by", () => {
  expect(profileFrom([{ username: "ada", me: false }])).toEqual({
    username: "me",
  });
});

test("retries after a failed fetch instead of caching the failure", async () => {
  vi.resetModules();
  const { loadAccounts } = await import("./accounts.ts");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const authenticatedFetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("network unreachable"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ username: "ada", me: true }]), {
        status: 200,
      }),
    );
  const client = {
    httpSpacePrimitives: {
      url: "http://localhost:3000/.fs",
      authenticatedFetch,
    },
  } as unknown as Client;

  expect(await loadAccounts(client)).toEqual([]);
  expect(await loadAccounts(client)).toEqual([{ username: "ada", me: true }]);
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

test("retries after a non-ok response instead of caching the failure", async () => {
  vi.resetModules();
  const { loadProfile } = await import("./accounts.ts");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const authenticatedFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ username: "ada", me: true }]), {
        status: 200,
      }),
    );
  const client = {
    httpSpacePrimitives: {
      url: "http://localhost:3000/.fs",
      authenticatedFetch,
    },
  } as unknown as Client;

  expect(await loadProfile(client)).toEqual({ username: "me" });
  expect(await loadProfile(client)).toEqual({ username: "ada" });
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
