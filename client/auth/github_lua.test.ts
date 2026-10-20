import { beforeEach, describe, expect, test } from "vitest";
import { loadStdPages } from "../space_lua/std_page_harness_test_util.ts";

const PAGES = [
  "libraries/Library/Std/Infrastructure/Auth.md",
  "libraries/Library/Std/Infrastructure/Github.md",
];

describe("Github.md", () => {
  let cfg: Record<string, string>;
  let deviceFlows: Array<Record<string, string>>;
  let deviceToken: string;
  let fetches: Array<{ url: string; opts: any }>;
  // Status for a request, 200 by default
  let status: (url: string, opts: any) => number;
  let h: Awaited<ReturnType<typeof loadStdPages>>;

  beforeEach(async () => {
    cfg = {};
    deviceFlows = [];
    deviceToken = "gho_device";
    fetches = [];
    status = () => 200;
    h = await loadStdPages(
      PAGES,
      {
        editor: {},
        oauth: {
          deviceFlow: (opts: Record<string, string>) => {
            deviceFlows.push(opts);
            return { access_token: deviceToken };
          },
        },
        net: {
          proxyFetch: (url: string, opts: any) => {
            // Copy: callers may reuse the options table
            fetches.push({
              url,
              opts: { ...opts, headers: { ...opts?.headers } },
            });
            return {
              ok: true,
              status: status(url, opts),
              body: { tag_name: "v1", files: { "a.md": { content: "hi" } } },
            };
          },
        },
      },
      { config: cfg },
    );
  });

  test("uses the configured github.token without signing in", async () => {
    cfg["github.token"] = "pat123";
    await h.call("github.request", "https://api.github.com/gists", "POST", {});
    expect(deviceFlows).toHaveLength(0);
    expect(fetches[0].opts.headers.Authorization).toBe("Bearer pat123");
  });

  test("signs in through the device flow when nothing is configured", async () => {
    await h.call("github.request", "https://api.github.com/gists", "POST", {});
    expect(deviceFlows).toHaveLength(1);
    expect(deviceFlows[0].clientId).toBe("Ov23liZmRh8sR6UeL8fQ");
    expect(deviceFlows[0].scope).toBe("repo gist");
    expect(deviceFlows[0].deviceCodeUrl).toBe(
      "https://github.com/login/device/code",
    );
    expect(deviceFlows[0].tokenUrl).toBe(
      "https://github.com/login/oauth/access_token",
    );
    await h.call("github.request", "https://api.github.com/gists", "GET");
    expect(deviceFlows).toHaveLength(1);
    expect(fetches[0].opts.headers.Authorization).toBe("Bearer gho_device");
    expect(fetches[1].opts.headers.Authorization).toBe("Bearer gho_device");
    expect(fetches[1].opts.headers.Accept).toBe("application/vnd.github+json");
  });

  test("a rejected device-flow token is dropped and signed in again", async () => {
    await h.call("github.request", "https://api.github.com/gists", "GET");
    expect(deviceFlows).toHaveLength(1);
    // Revoked on github.com: the stored token now gets 401
    status = (_url, opts) =>
      opts?.headers?.Authorization === "Bearer gho_device" ? 401 : 200;
    deviceToken = "gho_new1";
    fetches = [];
    const res: any = await h.call(
      "github.request",
      "https://api.github.com/gists",
      "POST",
      {},
    );
    expect(res.status).toBe(200);
    expect(deviceFlows).toHaveLength(2);
    expect(fetches.map((f) => f.opts.headers.Authorization)).toEqual([
      "Bearer gho_device",
      "Bearer gho_new1",
    ]);
  });

  test("a rejected github.token is not retried", async () => {
    cfg["github.token"] = "revoked";
    status = () => 401;
    const res: any = await h.call(
      "github.request",
      "https://api.github.com/gists",
      "POST",
      {},
    );
    expect(res.status).toBe(401);
    expect(fetches).toHaveLength(1);
    expect(deviceFlows).toHaveLength(0);
  });

  test("honours github.clientId override", async () => {
    cfg["github.clientId"] = "my-client";
    await h.call("auth.headers", "github");
    expect(deviceFlows[0].clientId).toBe("my-client");
  });

  test("reads from private repos with auth headers", async () => {
    cfg["github.token"] = "pat123";
    const service = h.services.find(
      (s) => s.selector === "net.readURI:https://github.com/*",
    )!;
    await service.run({
      uri: "https://github.com/me/repo/blob/main/a.md",
    });
    expect(fetches[0].url).toBe(
      "https://raw.githubusercontent.com/me/repo/main/a.md",
    );
    expect(fetches[0].opts.headers.Authorization).toBe("Bearer pat123");
  });

  const readService = (selector: string) =>
    h.services.find((s) => s.selector === selector)!;

  test("public reads work without signing in", async () => {
    const ghr = await readService("net.readURI:ghr:*").run({
      uri: "ghr:me/repo/file.md",
    });
    const gist = await readService("net.readURI:https://gist.github.com/*").run(
      { uri: "https://gist.github.com/me/abc123" },
    );
    expect(ghr).toBeTruthy();
    expect(gist).toBe("hi");
    expect(deviceFlows).toHaveLength(0);
    expect(fetches.length).toBeGreaterThan(0);
    for (const f of fetches) {
      expect(f.opts?.headers?.Authorization).toBeUndefined();
    }
  });

  test("reads use an existing credential without prompting", async () => {
    await h.call("auth.setCredential", "github", { access_token: "stored" });
    await readService("net.readURI:ghr:*").run({ uri: "ghr:me/repo/file.md" });
    expect(deviceFlows).toHaveLength(0);
    expect(fetches[0].opts.headers.Authorization).toBe("Bearer stored");
  });

  test("reads never sign in, even with an expired credential", async () => {
    // Expired, and GitHub tokens can't be refreshed
    await h.call("auth.setCredential", "github", {
      access_token: "old",
      expires_at: 1,
    });
    await readService("net.readURI:ghr:*").run({ uri: "ghr:me/repo/file.md" });
    expect(deviceFlows).toHaveLength(0);
    expect(fetches[0].opts.headers?.Authorization).toBeUndefined();
  });

  test("raw and release downloads send only Authorization", async () => {
    cfg["github.token"] = "pat123";
    await readService("net.readURI:ghr:*").run({ uri: "ghr:me/repo/file.md" });
    await readService("net.readURI:github:*").run({
      uri: "github:me/repo/a.md",
    });
    const downloads = fetches.filter(
      (f) => !f.url.startsWith("https://api.github.com/"),
    );
    expect(downloads).toHaveLength(2);
    for (const f of downloads) {
      expect(f.opts.headers.Authorization).toBe("Bearer pat123");
      expect(f.opts.headers.Accept).toBeUndefined();
    }
  });

  test("reads retry anonymously when the token is rejected", async () => {
    cfg["github.token"] = "revoked";
    status = (_url, opts) => (opts?.headers?.Authorization ? 401 : 200);
    const reads: Array<[string, string]> = [
      ["net.readURI:ghr:*", "ghr:me/repo/file.md"],
      ["net.readURI:github:*", "github:me/repo/a.md"],
      [
        "net.readURI:https://github.com/*",
        "https://github.com/me/repo/blob/main/a.md",
      ],
      [
        "net.readURI:https://gist.github.com/*",
        "https://gist.github.com/me/abc123",
      ],
    ];
    for (const [selector, uri] of reads) {
      fetches = [];
      expect(await readService(selector).run({ uri }), uri).toBeTruthy();
      // Every rejected request is repeated once, without credentials
      const authed = fetches.filter((f) => f.opts.headers?.Authorization);
      const anonymous = fetches.filter((f) => !f.opts.headers?.Authorization);
      expect(authed.length, uri).toBeGreaterThan(0);
      expect(
        anonymous.map((f) => f.url),
        uri,
      ).toEqual(authed.map((f) => f.url));
    }
    expect(deviceFlows).toHaveLength(0);
  });
});
