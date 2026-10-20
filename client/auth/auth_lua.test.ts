import { beforeEach, describe, expect, test } from "vitest";
import { loadStdPages } from "../space_lua/std_page_harness_test_util.ts";

const AUTH = "libraries/Library/Std/Infrastructure/Auth.md";

describe("Auth.md", () => {
  let store: Map<string, any>;
  let connects: string[];
  let refreshes: number;
  let behavior: {
    expired: boolean;
    refreshThrows: boolean;
    connectError?: string;
  };
  let pick: (options: Array<{ name: string }>) => unknown;
  let confirms: string[];
  let confirmAnswer: boolean;
  let fetches: Array<{ url: string; opts: any }>;
  let status: (opts: any) => number;
  let h: Awaited<ReturnType<typeof loadStdPages>>;

  // All credentials live in one client store entry
  const stored = (key: string) => store.get("credentials")?.[key];
  const storedKeys = () => Object.keys(store.get("credentials") ?? {});

  beforeEach(async () => {
    store = new Map();
    connects = [];
    refreshes = 0;
    behavior = { expired: false, refreshThrows: false };
    pick = () => null;
    confirms = [];
    confirmAnswer = true;
    fetches = [];
    status = () => 200;
    h = await loadStdPages(
      [AUTH],
      {
        editor: {
          filterBox: (_label: string, options: Array<{ name: string }>) =>
            pick(options),
          confirm: (msg: string) => {
            confirms.push(msg);
            return confirmAnswer;
          },
          flashNotification: () => undefined,
        },
        net: {
          proxyFetch: (url: string, opts: any) => {
            fetches.push({ url, opts });
            return { status: status(opts), headers: {}, body: null };
          },
        },
      },
      { store },
    );
    await h.call("auth.defineProvider", {
      id: "test",
      connect: (target: string) => {
        connects.push(target);
        if (behavior.connectError) throw new Error(behavior.connectError);
        return { token: `t${connects.length}` };
      },
      refresh: () => {
        refreshes++;
        if (behavior.refreshThrows) throw new Error("refresh failed");
        return { token: "refreshed" };
      },
      expired: () => behavior.expired,
      headers: (cred: { token: string }) => ({ Authorization: cred.token }),
    });
  });

  test("stores a connected credential and reuses it", async () => {
    expect(await h.call("auth.headers", "test:x")).toEqual({
      Authorization: "t1",
    });
    expect(await h.call("auth.headers", "test:x")).toEqual({
      Authorization: "t1",
    });
    expect(connects).toEqual(["x"]);
    expect(stored("test:x").token).toBe("t1");
    expect(stored("test:x").provider).toBe("test");
    expect(typeof stored("test:x").createdAt).toBe("number");
    expect([...store.keys()]).toEqual(["credentials"]);
  });

  test("refreshes an expired credential", async () => {
    await h.call("auth.headers", "test");
    behavior.expired = true;
    expect(await h.call("auth.headers", "test")).toEqual({
      Authorization: "refreshed",
    });
    expect(refreshes).toBe(1);
    expect(connects).toHaveLength(1);
    expect(stored("test").token).toBe("refreshed");
    expect(storedKeys()).toEqual(["test"]);
  });

  test("reconnects when refresh fails", async () => {
    await h.call("auth.headers", "test");
    behavior.expired = true;
    behavior.refreshThrows = true;
    expect(await h.call("auth.headers", "test")).toEqual({
      Authorization: "t2",
    });
    expect(connects).toHaveLength(2);
    expect(stored("test").token).toBe("t2");
  });

  test("stores nothing when connect fails", async () => {
    behavior.connectError = "cancelled: user closed the dialog";
    await expect(h.call("auth.headers", "test:y")).rejects.toThrow(
      "cancelled:",
    );
    expect(storedKeys()).toEqual([]);
  });

  test("deleteCredential removes only that credential", async () => {
    await h.call("auth.headers", "test:a");
    await h.call("auth.headers", "test:b");
    await h.call("auth.deleteCredential", "test:a");
    expect(storedKeys()).toEqual(["test:b"]);
    expect(await h.call("auth.listKeys")).toEqual(["test:b"]);
  });

  test("Credentials: Clear offers clearing all of them at once", async () => {
    await h.call("auth.setCredential", "sb:https://h/notes", { token: "1" });
    await h.call("auth.setCredential", "github", { token: "2" });
    let offered: string[] = [];
    pick = (options) => {
      offered = options.map((o) => o.name);
      return options[0];
    };
    await h.commands.get("Credentials: Clear")!();
    expect(offered).toEqual([
      "All credentials",
      "github",
      "sb:https://h/notes",
    ]);
    expect(confirms).toEqual(["Clear all 2 stored credentials?"]);
    expect(storedKeys()).toEqual([]);
    expect(await h.call("auth.list")).toEqual({});
  });

  test("declining to clear all keeps every credential", async () => {
    await h.call("auth.setCredential", "sb:https://h/notes", { token: "1" });
    await h.call("auth.setCredential", "github", { token: "2" });
    pick = (options) => options[0];
    confirmAnswer = false;
    await h.commands.get("Credentials: Clear")!();
    expect(storedKeys()).toHaveLength(2);
  });

  test("Credentials: Clear with one credential offers no 'all' option", async () => {
    await h.call("auth.setCredential", "github", { token: "2" });
    let offered: string[] = [];
    pick = (options) => {
      offered = options.map((o) => o.name);
      return options[0];
    };
    await h.commands.get("Credentials: Clear")!();
    expect(offered).toEqual(["github"]);
    expect(confirms).toEqual(["Clear the credential github?"]);
    expect(stored("github")).toBeUndefined();
  });

  test("listKeys filters by prefix", async () => {
    await h.call("auth.setCredential", "sb:https://h/notes", { token: "1" });
    await h.call("auth.setCredential", "github", { token: "2" });
    expect(await h.call("auth.listKeys", "sb:")).toEqual([
      "sb:https://h/notes",
    ]);
    expect(await h.call("auth.listKeys")).toHaveLength(2);
  });

  test("lists credentials with their provider", async () => {
    await h.call("auth.setCredential", "sb:https://h/notes", { token: "1" });
    const list = (await h.call("auth.list")) as Array<{
      key: string;
      provider: string;
    }>;
    expect(list.map((i) => [i.key, i.provider])).toEqual([
      ["sb:https://h/notes", "sb"],
    ]);
  });

  test("optionalHeaders never signs in", async () => {
    expect(await h.call("auth.optionalHeaders", "test")).toBeNull();
    expect(connects).toEqual([]);
    expect(stored("test")).toBeUndefined();

    await h.call("auth.headers", "test");
    expect(await h.call("auth.optionalHeaders", "test")).toEqual({
      Authorization: "t1",
    });

    // Expired: renewed when possible
    behavior.expired = true;
    expect(await h.call("auth.optionalHeaders", "test")).toEqual({
      Authorization: "refreshed",
    });
    // ...otherwise no headers, and no sign-in
    behavior.refreshThrows = true;
    expect(await h.call("auth.optionalHeaders", "test")).toBeNull();
    expect(connects).toHaveLength(1);
  });

  const fetchTest = (signIn?: boolean) =>
    h.call("auth.fetch", "test", "https://api/x", { method: "POST" }, signIn);
  const sentAuth = () => fetches.map((f) => f.opts.headers.Authorization);

  test("fetch with signIn signs in, and again once when rejected", async () => {
    await h.call("auth.headers", "test");
    status = (opts) => (opts.headers.Authorization === "t1" ? 401 : 200);
    const res = (await fetchTest(true)) as { status: number };
    expect(res.status).toBe(200);
    expect(sentAuth()).toEqual(["t1", "t2"]);
    expect(fetches[1].opts.method).toBe("POST");
    expect(stored("test").token).toBe("t2");
    // Rejected again: no endless loop
    status = () => 401;
    fetches = [];
    expect(((await fetchTest(true)) as { status: number }).status).toBe(401);
    expect(fetches).toHaveLength(2);
  });

  test("fetch without signIn never signs in and retries anonymously", async () => {
    await fetchTest();
    expect(sentAuth()).toEqual([undefined]);
    expect(connects).toEqual([]);
    await h.call("auth.headers", "test");
    fetches = [];
    status = (opts) => (opts.headers.Authorization ? 401 : 200);
    expect(((await fetchTest()) as { status: number }).status).toBe(200);
    expect(sentAuth()).toEqual(["t1", undefined]);
    // The rejected credential is gone
    expect(stored("test")).toBeUndefined();
    expect(connects).toHaveLength(1);
  });

  test("a configured credential is used when none is stored, never stored", async () => {
    let configured: string | null = "pat";
    await h.call("auth.defineProvider", {
      id: "conf",
      connect: () => {
        connects.push("conf");
        return { token: "signed-in" };
      },
      configured: () => configured && { token: configured },
      headers: (cred: { token: string }) => ({ Authorization: cred.token }),
    });
    expect(await h.call("auth.headers", "conf")).toEqual({
      Authorization: "pat",
    });
    expect(await h.call("auth.optionalHeaders", "conf")).toEqual({
      Authorization: "pat",
    });
    expect(storedKeys()).toEqual([]);
    // Rejected: the user's to fix, so it's not replaced by signing in...
    status = () => 401;
    await h.call("auth.fetch", "conf", "https://api/x", {}, true);
    expect(fetches).toHaveLength(1);
    // ...but reads still go anonymous
    await h.call("auth.fetch", "conf", "https://api/x", {});
    expect(fetches.slice(1).map((f) => f.opts.headers.Authorization)).toEqual([
      "pat",
      undefined,
    ]);
    expect(connects).toEqual([]);
    // A stored credential takes precedence
    configured = null;
    expect(await h.call("auth.headers", "conf")).toEqual({
      Authorization: "signed-in",
    });
  });

  test("errors clearly for an unknown provider", async () => {
    await expect(h.call("auth.headers", "nope")).rejects.toThrow(
      "No auth provider: nope",
    );
  });
});
