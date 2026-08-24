import { expect, test, vi } from "vitest";
import { profileFrom } from "./profile.ts";
import type { Client } from "./client.ts";

test("uses the server's username when there is one", () => {
  expect(
    profileFrom({
      username: "ada",
      fullName: "Ada Lovelace",
      email: "ada@example.org",
    }),
  ).toEqual({
    username: "ada",
    fullName: "Ada Lovelace",
    email: "ada@example.org",
  });
});

test('falls back to "me" when the server reports no account', () => {
  expect(profileFrom({ username: null, fullName: null, email: null })).toEqual({
    username: "me",
  });
});

test('falls back to "me" for a malformed or missing response', () => {
  expect(profileFrom(undefined)).toEqual({ username: "me" });
  expect(profileFrom({})).toEqual({ username: "me" });
  expect(profileFrom({ username: "  " })).toEqual({ username: "me" });
});

test("keeps a full name even when there is no username", () => {
  expect(profileFrom({ username: null, fullName: "Ada Lovelace" })).toEqual({
    username: "me",
    fullName: "Ada Lovelace",
  });
});

test("retries after a failed fetch instead of caching the failure", async () => {
  vi.resetModules();
  const { loadProfile } = await import("./profile.ts");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const authenticatedFetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("network unreachable"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ username: "ada" }), { status: 200 }),
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

test("retries after a non-ok response instead of caching the failure", async () => {
  vi.resetModules();
  const { loadProfile } = await import("./profile.ts");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const authenticatedFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ username: "ada" }), { status: 200 }),
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
