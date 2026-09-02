import { describe, expect, test } from "vitest";
import { initials, loadProfile } from "./profile.ts";

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("loadProfile", () => {
  test("200 yields a signed-in profile", async () => {
    const state = await loadProfile(async () =>
      res(200, { username: "grace", fullName: "Grace Hopper", admin: true }),
    );
    expect(state).toEqual({
      status: "signed-in",
      username: "grace",
      fullName: "Grace Hopper",
      admin: true,
    });
  });

  test("401 means signed out, not an error", async () => {
    expect(await loadProfile(async () => res(401))).toEqual({
      status: "signed-out",
    });
  });

  test("a missing full name is null, not undefined", async () => {
    const state = await loadProfile(async () =>
      res(200, { username: "grace", admin: false }),
    );
    expect(state).toMatchObject({ status: "signed-in", fullName: null });
  });

  test("any other failure is unavailable, so a blip never claims you are signed out", async () => {
    expect(await loadProfile(async () => res(500))).toEqual({
      status: "unavailable",
    });
    expect(
      await loadProfile(async () => {
        throw new Error("offline");
      }),
    ).toEqual({ status: "unavailable" });
  });

  test("requests the origin-absolute path, not one relative to a space prefix", async () => {
    let seen = "";
    await loadProfile(async (url) => {
      seen = String(url);
      return res(401);
    });
    expect(seen).toBe("/.spaces/api/profile");
  });
});

describe("initials", () => {
  test("two-part full name", () => {
    expect(initials({ username: "ghopper", fullName: "Grace Hopper" })).toBe(
      "GH",
    );
  });
  test("single-part full name", () => {
    expect(initials({ username: "qq", fullName: "Grace" })).toBe("G");
  });
  test("more than two parts uses first and last", () => {
    expect(initials({ username: "x", fullName: "Ada Byron Lovelace" })).toBe(
      "AL",
    );
  });
  test("falls back to the username", () => {
    expect(initials({ username: "grace", fullName: null })).toBe("G");
  });
  test("falls back to the username when the full name is only whitespace", () => {
    expect(initials({ username: "grace", fullName: "   " })).toBe("G");
  });
  test("uppercases a lowercase name", () => {
    expect(initials({ username: "x", fullName: "ada lovelace" })).toBe("AL");
  });
  test("handles a name outside the BMP without splitting it", () => {
    expect(initials({ username: "x", fullName: "𝒜da Lovelace" })).toBe("𝒜L");
  });
});
