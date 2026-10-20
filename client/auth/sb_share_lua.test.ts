import { beforeEach, describe, expect, test } from "vitest";
import { loadStdPages } from "../space_lua/std_page_harness_test_util.ts";

const PAGES = [
  "libraries/Library/Std/Infrastructure/Auth.md",
  "libraries/Library/Std/Infrastructure/SilverBullet Share.md",
];

type Fetch = { url: string; opts: any };
type Response = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

// A SilverBullet space answers <root>/.ping with an x-server-version header
const pingAt =
  (root: string) =>
  (url: string): Response =>
    url === `${root}/.ping`
      ? { status: 200, headers: { "x-server-version": "2.12.1" } }
      : { status: 404 };

describe("SilverBullet Share.md", () => {
  let cfg: Record<string, unknown>;
  let store: Map<string, any>;
  let fetches: Fetch[];
  let respond: (url: string, opts: any) => Response;
  let deviceFlows: Array<Record<string, string>>;
  let deviceFlowError: string | undefined;
  let prompts: string[];
  let promptAnswers: Array<string | null>;
  let filterBoxes: Array<{ label: string; options: string[] }>;
  let pick: string | undefined;
  let configWrites: Array<{ fn: string; path: string; value: unknown }>;
  let confirms: string[];
  let confirmAnswer: boolean;
  let writes: Array<{ uri: string; content: string }>;

  const load = () =>
    loadStdPages(
      PAGES,
      {
        system: {
          invokeFunction: (fn: string, path: string, value: unknown) => {
            configWrites.push({ fn, path, value });
          },
        },
        editor: {
          prompt: (label: string) => {
            prompts.push(label);
            return promptAnswers.shift() ?? null;
          },
          filterBox: (label: string, options: Array<{ name: string }>) => {
            filterBoxes.push({ label, options: options.map((o) => o.name) });
            return options.find((o) => o.name === pick) ?? null;
          },
          confirm: (msg: string) => {
            confirms.push(msg);
            return confirmAnswer;
          },
        },
        oauth: {
          deviceFlow: (opts: Record<string, string>) => {
            deviceFlows.push(opts);
            if (deviceFlowError) throw new Error(deviceFlowError);
            return {
              access_token: `access${deviceFlows.length}`,
              refresh_token: "refresh",
              expires_in: 3600,
            };
          },
        },
        net: {
          writeURI: (uri: string, content: string) => {
            writes.push({ uri, content });
          },
          proxyFetch: (url: string, opts: any) => {
            fetches.push({ url, opts });
            const r = respond(url, opts);
            return {
              ok: true,
              status: r.status,
              headers: r.headers ?? {},
              body: r.body ?? null,
            };
          },
        },
      },
      { store, config: cfg },
    );

  // All credentials live in one client store entry
  const stored = (key: string) => store.get("credentials")?.[key];
  const storeCredential = (key: string, cred: Record<string, unknown>) =>
    store.set("credentials", { ...store.get("credentials"), [key]: cred });

  const seedIndex = (...spaces: string[]) => {
    for (const space of spaces) {
      storeCredential(`sb:${space}`, {
        access_token: `token-${space}`,
        provider: "sb",
      });
    }
  };

  const service = (
    h: Awaited<ReturnType<typeof load>>,
    selector: string,
    name?: string,
  ) =>
    h.services.find(
      (s) =>
        s.selector === selector &&
        (!name || (s.match as { name?: string })?.name === name),
    )!;

  // The SilverBullet transport: one service pair for all spaces
  const READ = "net.readURI:http*";
  const WRITE = "net.writeURI:http*";

  // Multiple Lua return values come back as a LuaMultiRes
  const resolve = async (h: Awaited<ReturnType<typeof load>>, uri: string) => {
    const r = (await h.call("sbShare.resolve", uri)) as { values?: unknown };
    return r?.values ?? r;
  };

  // Service results are raw Lua values
  const onboard = async (
    h: Awaited<ReturnType<typeof load>>,
    data: { name: string; text: string },
  ) => {
    const r = (await service(h, "share:onboard", "SilverBullet space").run(
      data,
    )) as { toJS?: () => unknown } | null;
    return (r?.toJS ? r.toJS() : r) as Record<string, string>;
  };

  beforeEach(() => {
    cfg = {};
    store = new Map();
    fetches = [];
    respond = () => ({ status: 200 });
    deviceFlows = [];
    deviceFlowError = undefined;
    prompts = [];
    promptAnswers = [];
    filterBoxes = [];
    pick = undefined;
    configWrites = [];
    confirms = [];
    confirmAnswer = true;
    writes = [];
  });

  test("findSpaceRoot normalizes trailing slashes and page URLs", async () => {
    respond = pingAt("https://h/notes");
    const h = await load();
    for (const input of [
      "https://h/notes/",
      "https://h/notes/Index",
      "https://h/notes/Projects/Plan",
    ]) {
      expect(await h.call("sbShare.findSpaceRoot", input)).toBe(
        "https://h/notes",
      );
    }
    // Longest prefix is probed first (fresh session: no cached misses)
    fetches = [];
    const fresh = await load();
    await fresh.call("sbShare.findSpaceRoot", "https://h/notes/Projects/Plan");
    expect(fetches.map((f) => f.url)).toEqual([
      "https://h/notes/Projects/Plan/.ping",
      "https://h/notes/Projects/.ping",
      "https://h/notes/.ping",
    ]);
    expect(await h.call("sbShare.findSpaceRoot", "https://x/y")).toBeNull();
  });

  test("resolve picks the longest prefix at a segment boundary", async () => {
    seedIndex("https://h", "https://h/notes", "https://h/notes2");
    const h = await load();
    expect(await resolve(h, "https://h/notes2/A")).toEqual([
      "https://h/notes2",
      "A",
    ]);
    expect(await resolve(h, "https://h/notes/A")).toEqual([
      "https://h/notes",
      "A",
    ]);
    expect(await resolve(h, "https://h/other/A")).toEqual([
      "https://h",
      "other/A",
    ]);
    expect(await resolve(h, "https://elsewhere/A")).toBeNull();
  });

  test("page names round-trip", async () => {
    seedIndex("https://h/n");
    const h = await load();
    const uri = "https://h/n/Projects/Caf%C3%A9%20Plan";
    expect(
      await h.call("sbShare.pageUri", "https://h/n", "Projects/Café Plan"),
    ).toBe(uri);
    expect(await resolve(h, uri)).toEqual([
      "https://h/n",
      "Projects/Café Plan",
    ]);
    // Astral characters (surrogate pairs) survive too
    const emoji = (await h.call(
      "sbShare.pageUri",
      "https://h/n",
      "A 😀",
    )) as string;
    expect(emoji).toBe(`https://h/n/${encodeURIComponent("A 😀")}`);
    expect(await resolve(h, emoji)).toEqual(["https://h/n", "A 😀"]);
    await service(h, WRITE).run({
      uri,
      content: "hello",
    });
    const put = fetches.find((f) => f.opts.method === "PUT")!;
    expect(put.url).toBe("https://h/n/.fs/Projects/Caf%C3%A9%20Plan.md");
    expect(put.opts.body).toBe("hello");
    expect(put.opts.headers.Authorization).toBe("Bearer token-https://h/n");
  });

  test("a conditional write sends If-Match after a read and reports a 412 as a conflict", async () => {
    seedIndex("https://h/n");
    const h = await load();
    respond = (_url, opts) =>
      opts.method === "PUT"
        ? { status: 412 }
        : { status: 200, headers: { etag: '"abc"' }, body: "remote text" };
    const read = service(h, READ);
    const write = service(h, WRITE);
    expect(await read.run({ uri: "https://h/n/Page" })).toBe("remote text");
    expect(fetches[0].url).toBe("https://h/n/.fs/Page.md");
    expect(fetches[0].opts.headers.Authorization).toBe(
      "Bearer token-https://h/n",
    );
    const written = (await write.run({
      uri: "https://h/n/Page",
      content: "local",
      conditional: true,
    })) as { toJS?: () => unknown };
    expect(written.toJS ? written.toJS() : written).toEqual({ conflict: true });
    expect(fetches[1].opts.method).toBe("PUT");
    expect(fetches[1].opts.headers["If-Match"]).toBe('"abc"');

    // A failed read is an error, not empty content; a missing page is nil
    respond = () => ({ status: 500 });
    await expect(read.run({ uri: "https://h/n/Page" })).rejects.toThrow(
      /read failed \(500\)/,
    );
    respond = () => ({ status: 404 });
    expect(await read.run({ uri: "https://h/n/Page" })).toBeNull();
  });

  test("a successful write updates the remembered ETag", async () => {
    seedIndex("https://h/n");
    const h = await load();
    respond = (_url, opts) =>
      opts.method === "PUT"
        ? { status: 200, headers: { etag: '"new"' } }
        : { status: 200, headers: { etag: '"old"' }, body: "x" };
    const write = service(h, WRITE);
    await service(h, READ).run({ uri: "https://h/n/Page" });
    const uri = "https://h/n/Page";
    await write.run({ uri, content: "1", conditional: true });
    await write.run({ uri, content: "2", conditional: true });
    expect(fetches[1].opts.headers["If-Match"]).toBe('"old"');
    expect(fetches[2].opts.headers["If-Match"]).toBe('"new"');
  });

  test("an unconditional write never sends If-Match", async () => {
    seedIndex("https://h/n");
    const h = await load();
    respond = () => ({ status: 200, headers: { etag: '"e"' }, body: "x" });
    await service(h, READ).run({ uri: "https://h/n/Page" });
    await service(h, WRITE).run({ uri: "https://h/n/Page", content: "1" });
    await service(h, WRITE).run({ uri: "https://h/n/Page", content: "2" });
    expect(fetches[1].opts.headers["If-Match"]).toBeUndefined();
    expect(fetches[2].opts.headers["If-Match"]).toBeUndefined();
  });

  test("the transport only claims URIs of known spaces, also ones added later", async () => {
    const h = await load();
    const match = service(h, READ).match as (d: unknown) => Promise<unknown>;
    expect(await match({ uri: "https://h/a/Page" })).toBeFalsy();
    cfg["share.silverbullet.spaces"] = ["https://h/a"];
    expect(await match({ uri: "https://h/a/Page" })).toEqual({ priority: 20 });
    expect(await match({ uri: "https://h/b/Page" })).toBeFalsy();
    expect(
      await (service(h, WRITE).match as (d: unknown) => Promise<unknown>)({
        uri: "https://h/a/Page",
      }),
    ).toEqual({ priority: 20 });
  });

  test("onboarding offers known spaces from space config", async () => {
    cfg["share.silverbullet.spaces"] = ["https://h/b", "https://h/a"];
    seedIndex("https://h/b", "https://h/a");
    const h = await load();
    pick = "https://h/a";
    promptAnswers = ["Shared/Page"];
    const result = await onboard(h, { name: "Current", text: "body" });
    expect(filterBoxes).toEqual([
      {
        label: "SilverBullet space",
        options: ["https://h/b", "https://h/a", "Another space…"],
      },
    ]);
    expect(prompts).toEqual(["Page path in that space"]);
    expect(deviceFlows).toHaveLength(0);
    // No hash: the push that follows uploads the page
    expect(result).toEqual({ uri: "https://h/a/Shared/Page", mode: "push" });
    expect(configWrites).toEqual([
      {
        fn: "configuration-manager.setConfigValue",
        path: "share.silverbullet.spaces",
        value: ["https://h/a", "https://h/b"],
      },
    ]);
  });

  test("onboarding checks for a remote page without uploading", async () => {
    cfg["share.silverbullet.spaces"] = ["https://h/a"];
    seedIndex("https://h/a");
    const h = await load();
    respond = (url) =>
      url.includes("/.fs/") ? { status: 404 } : { status: 200 };
    pick = "https://h/a";
    promptAnswers = ["Shared/Page"];
    const result = await onboard(h, { name: "Current", text: "body" });
    expect(writes).toEqual([]);
    expect(confirms).toEqual([]);
    expect(result.uri).toBe("https://h/a/Shared/Page");
    const check = fetches.find((f) => f.url.includes("/.fs/"))!;
    expect(check.url).toBe("https://h/a/.fs/Shared/Page.md");
    expect(check.opts.headers.Authorization).toBe("Bearer token-https://h/a");
  });

  test("onboarding asks before overwriting an existing remote page", async () => {
    cfg["share.silverbullet.spaces"] = ["https://h/b", "https://h/a"];
    seedIndex("https://h/b", "https://h/a");
    const h = await load();
    respond = () => ({ status: 200, body: "remote" });
    pick = "https://h/a";
    promptAnswers = ["Page", "Page"];
    confirmAnswer = false;
    expect(await onboard(h, { name: "Current", text: "body" })).toBeFalsy();
    expect(confirms).toEqual([
      "Page already exists in https://h/a. Overwrite it?",
    ]);
    // Declining must not remember the space
    expect(configWrites).toEqual([]);
    confirmAnswer = true;
    const result = await onboard(h, { name: "Current", text: "body" });
    expect(result.uri).toBe("https://h/a/Page");
    expect(configWrites).toHaveLength(1);
  });

  test("picking the most recent space leaves the config alone", async () => {
    cfg["share.silverbullet.spaces"] = ["https://h/a", "https://h/b"];
    seedIndex("https://h/a");
    const h = await load();
    pick = "https://h/a";
    promptAnswers = ["Page"];
    respond = () => ({ status: 404 });
    await onboard(h, { name: "Current", text: "body" });
    expect(configWrites).toHaveLength(0);
  });

  test("a known space without a local credential connects on pick", async () => {
    cfg["share.silverbullet.spaces"] = ["https://h/b", "https://h/a"];
    const h = await load();
    pick = "https://h/a";
    promptAnswers = ["Shared/Page"];
    await onboard(h, {
      name: "Current",
      text: "body",
    });
    expect(deviceFlows).toHaveLength(1);
    expect(deviceFlows[0].deviceCodeUrl).toBe("https://h/a/.auth/device/code");
    expect(stored("sb:https://h/a").access_token).toBe("access1");
  });

  test("onboarding returns a plain URL share config", async () => {
    respond = pingAt("https://h/notes");
    const h = await load();
    pick = "Another space…";
    promptAnswers = ["https://h/notes/", "Shared/Page"];
    const result = await onboard(h, { name: "Current", text: "body" });
    expect(prompts).toEqual(["Space URL", "Page path in that space"]);
    expect(result.uri).toBe("https://h/notes/Shared/Page");
    expect(result.mode).toBe("push");
    expect(deviceFlows).toHaveLength(1);
    expect(deviceFlows[0].clientId).toBe("silverbullet-share");
    expect(deviceFlows[0].deviceCodeUrl).toBe(
      "https://h/notes/.auth/device/code",
    );
    expect(deviceFlows[0].tokenUrl).toBe("https://h/notes/.auth/token");
    const cred = stored("sb:https://h/notes");
    expect(cred.access_token).toBe("access1");
    expect(cred.refresh_token).toBe("refresh");
    expect(typeof cred.expires_at).toBe("number");
    expect(configWrites[0].value).toEqual(["https://h/notes"]);
    // No stored key or config entry keeps a trailing slash
    for (const key of [
      ...store.keys(),
      ...Object.keys(store.get("credentials")),
    ]) {
      expect(key.endsWith("/")).toBe(false);
    }
    for (const url of configWrites[0].value as string[]) {
      expect(url.endsWith("/")).toBe(false);
    }
    expect(await resolve(h, "https://h/notes/Shared/Page")).toEqual([
      "https://h/notes",
      "Shared/Page",
    ]);
  });

  test("onboarding rejects a URL that is not a SilverBullet space", async () => {
    respond = () => ({ status: 404 });
    const h = await load();
    pick = "Another space…";
    promptAnswers = ["https://example.com/x"];
    await expect(
      service(h, "share:onboard", "SilverBullet space").run({
        name: "Current",
        text: "body",
      }),
    ).rejects.toThrow(/Not a SilverBullet space: https:\/\/example.com\/x/);
  });

  test("old remote surfaces a clear error", async () => {
    deviceFlowError = "failed: unauthorized_client";
    const h = await load();
    await expect(h.call("auth.headers", "sb:https://h/old")).rejects.toThrow(
      /too old/,
    );
    expect(stored("sb:https://h/old")).toBeUndefined();
  });

  test("refresh posts a refresh_token grant to the space", async () => {
    storeCredential("sb:https://h/n", {
      access_token: "stale",
      refresh_token: "r/1+=",
      expires_at: 1,
      space: "https://h/n",
      provider: "sb",
    });
    respond = () => ({
      status: 200,
      body: { access_token: "fresh", refresh_token: "r2", expires_in: 60 },
    });
    const h = await load();
    expect(await h.call("auth.headers", "sb:https://h/n")).toEqual({
      Authorization: "Bearer fresh",
    });
    expect(fetches[0].url).toBe("https://h/n/.auth/token");
    expect(fetches[0].opts.method).toBe("POST");
    expect(fetches[0].opts.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(fetches[0].opts.body).toBe(
      "grant_type=refresh_token&refresh_token=r%2F1%2B%3D&client_id=silverbullet-share",
    );
    expect(deviceFlows).toHaveLength(0);
    expect(stored("sb:https://h/n").refresh_token).toBe("r2");
  });

  test("overlapping spaces route to the longest matching space", async () => {
    seedIndex("https://h", "https://h/notes");
    const h = await load();
    // Dispatch like net.readURI/net.writeURI do (registry invokeBestMatch)
    const invokeBestMatch = async (selector: string, data: unknown) => {
      const matches = (await h.call("service.discover", selector, data)) as
        | Array<Record<string, unknown>>
        | undefined;
      expect(matches?.length).toBeGreaterThan(0);
      return h.call("service.invoke", matches![0], data);
    };
    await invokeBestMatch("net.writeURI:https://h/notes/A", {
      uri: "https://h/notes/A",
      content: "x",
    });
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("https://h/notes/.fs/A.md");
    expect(fetches[0].opts.headers.Authorization).toBe(
      "Bearer token-https://h/notes",
    );
    await invokeBestMatch("net.readURI:https://h/other/B", {
      uri: "https://h/other/B",
    });
    expect(fetches[1].url).toBe("https://h/.fs/other/B.md");
    expect(fetches[1].opts.headers.Authorization).toBe(
      "Bearer token-https://h",
    );
  });

  test("onboarding cleans up the page path", async () => {
    respond = pingAt("https://h/notes");
    const h = await load();
    pick = "Another space…";
    promptAnswers = ["https://h/notes", "/Shared/Page.md"];
    const result = await onboard(h, { name: "Current", text: "body" });
    expect(result.uri).toBe("https://h/notes/Shared/Page");
  });

  test("findSpaceRoot ignores query and fragment and survives network errors", async () => {
    respond = (url) => {
      if (url === "https://h/notes/Page/.ping") {
        throw new Error("network down");
      }
      return pingAt("https://h/notes")(url);
    };
    const h = await load();
    expect(
      await h.call("sbShare.findSpaceRoot", "https://h/notes/Page?x=1#top"),
    ).toBe("https://h/notes");
    expect(fetches[0].url).toBe("https://h/notes/Page/.ping");
    respond = () => {
      throw new Error("network down");
    };
    expect(await h.call("sbShare.findSpaceRoot", "https://h/a#b")).toBeNull();
  });

  test("a read rejected with 401 drops the credential and tries anonymously", async () => {
    seedIndex("https://h/n");
    const h = await load();
    respond = () => ({ status: 401 });
    await expect(
      service(h, READ).run({ uri: "https://h/n/P" }),
    ).rejects.toThrow(
      "Not connected to https://h/n: share a page to it in push or sync mode to sign in",
    );
    expect(fetches.map((f) => f.opts.headers.Authorization)).toEqual([
      "Bearer token-https://h/n",
      undefined,
    ]);
    expect(stored("sb:https://h/n")).toBeUndefined();
    expect(deviceFlows).toHaveLength(0);
  });

  test("a write rejected with 401 signs in again, once", async () => {
    seedIndex("https://h/n");
    const h = await load();
    respond = (_url, opts) =>
      opts.headers.Authorization === "Bearer access1"
        ? { status: 200 }
        : { status: 401 };
    await service(h, WRITE).run({ uri: "https://h/n/P", content: "x" });
    expect(deviceFlows).toHaveLength(1);
    expect(fetches.map((f) => f.opts.headers.Authorization)).toEqual([
      "Bearer token-https://h/n",
      "Bearer access1",
    ]);
    // Rejected again: an error, not another sign-in
    respond = () => ({ status: 401 });
    await expect(
      service(h, WRITE).run({ uri: "https://h/n/P", content: "x" }),
    ).rejects.toThrow(/write failed \(401\)/);
    expect(deviceFlows).toHaveLength(2);
  });

  test("share:ensure connects to an unknown space", async () => {
    seedIndex("https://h/known");
    respond = pingAt("https://h/new");
    const h = await load();
    // Writers of other providers, like Github.md's
    for (const [host, priority] of [
      ["github.com", 10],
      ["gist.github.com", 10],
      ["custom.example", 5],
      ["fallback.example", 0],
    ] as const) {
      h.services.push({
        selector: `net.writeURI:https://${host}/*`,
        match: { priority },
        run: async () => undefined,
        id: `writer-${host}`,
      });
    }
    const ensure = h.services.find((s) => s.selector === "share:ensure")!;
    const match = ensure.match as (d: unknown) => Promise<unknown>;
    expect(await match({ uri: "https://h/new/Page" })).toEqual({
      priority: 10,
    });
    // Known spaces too: run checks for a usable credential
    expect(await match({ uri: "https://h/known/Page" })).toEqual({
      priority: 10,
    });
    expect(await match({ uri: "https://github.com/a/b" })).toBeFalsy();
    expect(await match({ uri: "https://gist.github.com/a/b" })).toBeFalsy();
    expect(await match({ uri: "https://custom.example/a" })).toBeFalsy();
    // A writer without priority doesn't claim the URI
    expect(await match({ uri: "https://fallback.example/a" })).toEqual({
      priority: 10,
    });
    expect(await match({ uri: "github:a/b/c" })).toBeFalsy();
    expect(await ensure.run({ uri: "https://h/new/Page" })).toBe(true);
    expect(deviceFlows).toHaveLength(1);
    expect(await resolve(h, "https://h/new/Page")).toEqual([
      "https://h/new",
      "Page",
    ]);
    expect(configWrites.map((w) => w.value)).toEqual([["https://h/new"]]);
  });

  test("share:ensure handles http: spaces too", async () => {
    respond = pingAt("http://localhost:3000/notes");
    const h = await load();
    const ensure = h.services.find((s) => s.selector === "share:ensure")!;
    const match = ensure.match as (d: unknown) => Promise<unknown>;
    const uri = "http://localhost:3000/notes/Page";
    expect(await match({ uri })).toEqual({ priority: 10 });
    expect(await ensure.run({ uri })).toBe(true);
    expect(deviceFlows).toHaveLength(1);
    expect(await resolve(h, uri)).toEqual([
      "http://localhost:3000/notes",
      "Page",
    ]);
  });

  test("share:ensure signs in to a known space without a local credential", async () => {
    cfg["share.silverbullet.spaces"] = ["https://h/n"];
    seedIndex("https://h/connected");
    const h = await load();
    const ensure = h.services.find((s) => s.selector === "share:ensure")!;
    const match = ensure.match as (d: unknown) => Promise<unknown>;
    expect(await match({ uri: "https://h/n/Page" })).toEqual({ priority: 10 });
    // Connected already: nothing to do, nothing asked
    expect(await ensure.run({ uri: "https://h/connected/Page" })).toBe(true);
    expect(confirms).toEqual([]);
    expect(await ensure.run({ uri: "https://h/n/Page" })).toBe(true);
    expect(confirms).toEqual(["Sign in to https://h/n?"]);
    expect(deviceFlows).toHaveLength(1);
    // Known already: no probes, and the config is left alone
    expect(fetches).toEqual([]);
    expect(configWrites).toEqual([]);
    expect(stored("sb:https://h/n").access_token).toBe("access1");
  });

  test("share:ensure fails when connecting is declined", async () => {
    respond = pingAt("https://h/new");
    confirmAnswer = false;
    const h = await load();
    const ensure = h.services.find((s) => s.selector === "share:ensure")!;
    await expect(ensure.run({ uri: "https://h/new/Page" })).rejects.toThrow(
      "Not connected to https://h/new",
    );
    expect(deviceFlows).toHaveLength(0);
    expect(configWrites).toEqual([]);
  });

  test("findSpaceRoot remembers only definitive misses", async () => {
    const statuses: Record<string, number | "throw"> = {
      "https://x/a/401": 401,
      "https://x/a/429": 429,
      "https://x/a/500": 500,
      "https://x/a/net": "throw",
      "https://x/a/404": 404,
      "https://x/a/405": 405,
      "https://x/a/200": 200,
    };
    respond = (url) => {
      const status = statuses[url.replace(/\/\.ping$/, "")] ?? 404;
      if (status === "throw") throw new Error("network down");
      return { status };
    };
    const h = await load();
    const probes = async (url: string) => {
      fetches = [];
      await h.call("sbShare.findSpaceRoot", url);
      return fetches.filter((f) => f.url === `${url}/.ping`).length;
    };
    for (const url of Object.keys(statuses)) {
      expect(await probes(url), url).toBe(1);
    }
    // Probed again: transient failures only
    for (const url of Object.keys(statuses)) {
      const transient = !/(404|405|200)$/.test(url);
      expect(await probes(url), url).toBe(transient ? 1 : 0);
    }
  });

  test("findSpaceRoot sends a stored credential, and never signs in", async () => {
    seedIndex("https://h/notes");
    respond = pingAt("https://h/notes");
    const h = await load();
    expect(await h.call("sbShare.findSpaceRoot", "https://h/notes/P")).toBe(
      "https://h/notes",
    );
    const ping = fetches.find((f) => f.url === "https://h/notes/.ping")!;
    expect(ping.opts.headers.Authorization).toBe(
      "Bearer token-https://h/notes",
    );
    const other = fetches.find((f) => f.url === "https://h/notes/P/.ping")!;
    expect(other.opts.headers?.Authorization).toBeUndefined();
    expect(deviceFlows).toHaveLength(0);
  });

  test("a catch-all host answering 200 without a server version is no space", async () => {
    respond = () => ({ status: 200, body: "<html>anything</html>" });
    const h = await load();
    expect(
      await h.call("sbShare.findSpaceRoot", "https://static.example/a/Page"),
    ).toBeNull();
  });

  test("share:ensure probes a non-space URI only once per session", async () => {
    respond = () => ({ status: 404 });
    const h = await load();
    const ensure = h.services.find((s) => s.selector === "share:ensure")!;
    expect(await ensure.run({ uri: "https://x/a/Page" })).toBe(false);
    expect(fetches.map((f) => f.url)).toEqual([
      "https://x/a/Page/.ping",
      "https://x/a/.ping",
      "https://x/.ping",
    ]);
    expect(await ensure.run({ uri: "https://x/a/Page" })).toBe(false);
    expect(fetches).toHaveLength(3);
  });
});
