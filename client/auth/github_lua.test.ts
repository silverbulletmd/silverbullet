import { beforeEach, describe, expect, test } from "vitest";
import { loadStdPages } from "../space_lua/std_page_harness_test_util.ts";

const PAGES = [
  "libraries/Library/Std/Infrastructure/Auth.md",
  "libraries/Library/Std/Infrastructure/Github.md",
];

// Errors as strings: Lua error objects don't survive vitest's reporting
const threw = (run: () => unknown) =>
  (async () => run())().catch((e: Error) => `THREW ${e.message}`);

describe("Github.md", () => {
  let cfg: Record<string, string>;
  let deviceFlows: Array<Record<string, string>>;
  let deviceToken: string;
  let fetches: Array<{ url: string; opts: any }>;
  // Status for a request, 200 by default
  let status: (url: string, opts: any) => number;
  // Body for a request, undefined for the default one
  let body: (url: string, opts: any) => unknown;
  let commitMessage: string | undefined;
  let h: Awaited<ReturnType<typeof loadStdPages>>;

  beforeEach(async () => {
    cfg = {};
    deviceFlows = [];
    deviceToken = "gho_device";
    fetches = [];
    status = () => 200;
    body = () => undefined;
    commitMessage = "Publish docs";
    h = await loadStdPages(
      PAGES,
      {
        editor: {
          prompt: (message: string, def?: string) => {
            const answers: Record<string, string> = {
              "Github repo (user/repo):": "me/repo",
              "Branch:": "main",
              "File path:": "notes/page.md",
              "File name": "page.md",
            };
            if (message === "Commit message:") return commitMessage;
            return answers[message] ?? def;
          },
          flashNotification: () => {},
        },
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
            const code = status(url, opts);
            return {
              ok: code >= 200 && code < 300,
              status: code,
              body: body(url, opts) ?? {
                tag_name: "v1",
                sha: "abc123",
                files: { "a.md": { content: "hi" } },
              },
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

  test("file providers and gists define share targets", () => {
    const selectors = h.services
      .filter((s) => s.selector.startsWith("share:target:"))
      .map((s) => s.selector)
      .sort();
    expect(selectors).toEqual([
      "share:target:github:*",
      "share:target:https://gist.github.com/*",
      "share:target:https://github.com/*",
    ]);
  });

  const onboardService = (name: string) =>
    h.services.find(
      (s) => s.selector === "share:onboard" && (s.match as any).name === name,
    )!;

  test("file onboarding returns the URI without uploading or hashing", async () => {
    cfg["github.name"] = "Jo";
    cfg["github.email"] = "jo@example.com";
    cfg["github.token"] = "pat123";
    const res: any = await onboardService("Github file").run({
      name: "page",
      text: "raw text",
      content: "published text",
    });
    expect(res).toEqual({
      uri: "https://github.com/me/repo/blob/main/notes/page.md",
      mode: "push",
    });
    expect(fetches).toHaveLength(0);
  });

  const writeService = () => readService("net.writeURI:https://github.com/*");

  test("writing a missing file creates it without a sha", async () => {
    cfg["github.name"] = "Jo";
    cfg["github.email"] = "jo@example.com";
    cfg["github.token"] = "pat123";
    status = (_url, opts) => (opts?.method === "GET" ? 404 : 200);
    await writeService().run({
      uri: "https://github.com/me/repo/blob/main/notes/page.md",
      content: "hello",
    });
    const put = fetches.find((f) => f.opts.method === "PUT")!;
    expect(put.opts.body).not.toHaveProperty("sha");
    expect(put.opts.body.content).toBe("aGVsbG8=");
    expect(put.opts.body.committer.name).toBe("Jo");
  });

  test("writing an existing file sends its sha", async () => {
    cfg["github.name"] = "Jo";
    cfg["github.email"] = "jo@example.com";
    cfg["github.token"] = "pat123";
    await writeService().run({
      uri: "https://github.com/me/repo/blob/main/notes/page.md",
      content: "hello",
    });
    const put = fetches.find((f) => f.opts.method === "PUT")!;
    expect(put.opts.body.sha).toBe("abc123");
  });

  test("writing fails when the existing file cannot be checked", async () => {
    cfg["github.name"] = "Jo";
    cfg["github.email"] = "jo@example.com";
    cfg["github.token"] = "pat123";
    status = (_url, opts) => (opts?.method === "GET" ? 500 : 200);
    await expect(
      writeService().run({
        uri: "https://github.com/me/repo/blob/main/notes/page.md",
        content: "hello",
      }),
    ).rejects.toThrow();
    expect(fetches.some((f) => f.opts.method === "PUT")).toBe(false);
  });

  test("gist onboarding creates the gist from the transformed content", async () => {
    cfg["github.token"] = "pat123";
    const res: any = await onboardService("Github Gist").run({
      name: "page",
      text: "raw text",
      content: "published text",
    });
    expect(res.hash).toBeUndefined();
    expect(res.mode).toBe("push");
    const post = fetches.find((f) => f.opts.method === "POST")!;
    expect(post.opts.body.files["page.md"].content).toBe("published text");
  });

  test("github: URIs keep nested paths", async () => {
    await readService("net.readURI:github:*").run({
      uri: "github:u/r@dev/docs/A.md",
    });
    expect(fetches[0].url).toBe(
      "https://raw.githubusercontent.com/u/r/dev/docs/A.md",
    );
  });

  test("a missing file reads as nil, other failures as errors", async () => {
    for (const [selector, uri] of [
      ["net.readURI:github:*", "github:u/r/A.md"],
      [
        "net.readURI:https://github.com/*",
        "https://github.com/u/r/blob/main/A.md",
      ],
      ["net.readURI:ghr:*", "ghr:u/r/A.md"],
    ]) {
      status = () => 404;
      expect(await readService(selector).run({ uri })).toBeFalsy();
      status = () => 403;
      expect(await threw(() => readService(selector).run({ uri }))).toMatch(
        /^THREW .*403/,
      );
    }
  });

  test("a refused write is an error", async () => {
    cfg["github.name"] = "Jo";
    cfg["github.email"] = "jo@example.com";
    cfg["github.token"] = "pat123";
    status = (_url, opts) => (opts?.method === "PUT" ? 422 : 200);
    expect(
      await threw(() =>
        writeService().run({
          uri: "https://github.com/me/repo/blob/main/notes/page.md",
          content: "hello",
        }),
      ),
    ).toMatch(/^THREW .*422/);
  });

  describe("gists", () => {
    const GIST = "https://gist.github.com/u/abc";
    const API = "https://api.github.com/gists/abc";
    const run = (selector: string, data: unknown) =>
      threw(() => readService(selector).run(data));
    const target = async () =>
      (await readService("share:target:https://gist.github.com/*").run({
        uri: GIST,
      })) as any;
    const list = (extra = {}) =>
      run("net.listURI:https://gist.github.com/*", { uri: GIST, ...extra });

    beforeEach(() => {
      cfg["github.token"] = "pat123";
    });

    test("member URIs flatten the path into one file name", async () => {
      const t = await target();
      expect(await t.memberUri(GIST, "Blog/Post")).toBe(`${GIST}/Blog-Post.md`);
      expect(await t.memberUri(GIST, "My Notes/C D")).toBe(
        `${GIST}/My Notes-C D.md`,
      );
      expect(t.defaults).toEqual({
        links: true,
        comments: true,
        bake: true,
      });
    });

    test("links between files of the gist point at the file", async () => {
      const t = await target();
      const link = (toUri: string | undefined, text = "Post") =>
        t.link({ fromUri: `${GIST}/A.md`, toUri, text, page: "Blog/Post" });
      expect(await link(`${GIST}/Blog-Post.md`)).toBe(
        "[Post](https://gist.github.com/u/abc#file-blog-post-md)",
      );
      expect(await link(`${GIST}/My Notes-C D.md`, "C")).toBe(
        "[C](https://gist.github.com/u/abc#file-my-notes-c-d-md)",
      );
      expect(await link("https://gist.github.com/u/other/B.md")).toBe("Post");
      expect(await link(`${GIST}/A.md`)).toBe("Post");
      expect(await link(undefined)).toBe("Post");
    });

    test("web URLs name the file with an anchor", async () => {
      const t = await target();
      expect(await t.webUrl(`${GIST}/Blog-Post.md`)).toBe(
        `${GIST}#file-blog-post-md`,
      );
      expect(await t.webUrl(GIST)).toBe(GIST);
      expect(await t.webUrl("https://gist.github.com/abc")).toBe(
        "https://gist.github.com/abc",
      );
    });

    test("listing names the gist's Markdown files, content or not", async () => {
      body = () => ({
        files: {
          "notes.txt": { content: "not a member" },
          "B.md": { content: "b" },
          // Large files come without their content
          "Big.md": { truncated: true, raw_url: "https://raw/big" },
          "A.md": { content: "a" },
        },
      });
      expect(await list()).toEqual([
        { uri: `${GIST}/A.md` },
        { uri: `${GIST}/B.md` },
        { uri: `${GIST}/Big.md` },
      ]);
      expect(fetches.map((f) => `${f.opts.method ?? "GET"} ${f.url}`)).toEqual([
        `GET ${API}`,
      ]);
    });

    test("a truncated gist is an error", async () => {
      body = () => ({ files: { "A.md": { content: "a" } }, truncated: true });
      expect(await list()).toBe(
        `THREW GitHub: too many files in ${GIST} to list`,
      );
    });

    test("a failed or refused listing is an error, never an empty gist", async () => {
      status = () => 404;
      expect(await list()).toBe(
        "THREW GitHub: gist abc not found (or not signed in to GitHub)",
      );
      status = () => 403;
      expect(await list()).toMatch(/^THREW GitHub refused .*: HTTP 403/);
    });

    test("listing signs in only when asked to", async () => {
      delete cfg["github.token"];
      body = () => ({ files: {} });
      await list();
      expect(deviceFlows).toHaveLength(0);
      expect(fetches[0].opts.headers.Authorization).toBeUndefined();
      await list({ signIn: true });
      expect(deviceFlows).toHaveLength(1);
      expect(fetches[1].opts.headers.Authorization).toBe("Bearer gho_device");
    });

    test("a file URI reads that file, fetching truncated content", async () => {
      body = (url) =>
        url === "https://raw/big"
          ? "big text"
          : {
              files: {
                "A.md": { content: "a" },
                "Big.md": { truncated: true, raw_url: "https://raw/big" },
              },
            };
      const read = (uri: string) =>
        run("net.readURI:https://gist.github.com/*", { uri });
      expect(await read(`${GIST}/A.md`)).toBe("a");
      expect(await read(`${GIST}/Big.md`)).toBe("big text");
      expect(await read(`${GIST}/Missing.md`)).toBeNull();
      expect(fetches.map((f) => f.url)).toEqual([
        API,
        API,
        "https://raw/big",
        API,
      ]);
      status = () => 500;
      expect(await read(`${GIST}/A.md`)).toMatch(/^THREW .*500/);
    });

    test("a file URI writes that file only", async () => {
      expect(
        await run("net.writeURI:https://gist.github.com/*", {
          uri: `${GIST}/My Notes-C D.md`,
          content: "c",
        }),
      ).toBeUndefined();
      expect(fetches).toHaveLength(1);
      expect(fetches[0].url).toBe(API);
      expect(fetches[0].opts.method).toBe("PATCH");
      expect(fetches[0].opts.body).toEqual({
        files: { "My Notes-C D.md": { content: "c" } },
      });
      status = () => 422;
      expect(
        await run("net.writeURI:https://gist.github.com/*", {
          uri: `${GIST}/A.md`,
          content: "a",
        }),
      ).toMatch(/^THREW .*422/);
    });

    test("a delete sends the file as JSON null", async () => {
      expect(
        await run("net.deleteURI:https://gist.github.com/*", {
          uri: `${GIST}/My Notes-C D.md`,
        }),
      ).toBeUndefined();
      expect(fetches).toHaveLength(1);
      expect(fetches[0].url).toBe(API);
      expect(fetches[0].opts.method).toBe("PATCH");
      expect(JSON.parse(fetches[0].opts.body)).toEqual({
        files: { "My Notes-C D.md": null },
      });
      status = () => 404;
      expect(
        await run("net.deleteURI:https://gist.github.com/*", {
          uri: `${GIST}/A.md`,
        }),
      ).toBeUndefined();
      expect(
        await run("net.deleteURI:https://gist.github.com/*", { uri: GIST }),
      ).toMatch(/^THREW /);
    });

    test("a single-page gist URI still writes its first .md file", async () => {
      body = (_url, opts) =>
        opts?.method === "PATCH"
          ? {}
          : {
              files: {
                "notes.txt": { content: "x" },
                "page.md": { content: "old" },
              },
            };
      expect(
        await run("net.writeURI:https://gist.github.com/*", {
          uri: GIST,
          content: "new",
        }),
      ).toBeUndefined();
      expect(fetches.map((f) => `${f.opts.method} ${f.url}`)).toEqual([
        `GET ${API}`,
        `PATCH ${API}`,
      ]);
      expect(fetches[1].opts.body.files).toEqual({
        "page.md": { content: "new" },
      });
    });
  });

  describe("collections", () => {
    const API = "https://api.github.com/repos/me/repo/";
    const ROOT = "github:me/repo@dev/docs";
    // The git data API, by path under API
    const gitBodies: Record<string, unknown> = {
      "git/ref/heads/dev": { object: { sha: "head1" } },
      "git/commits/head1": { tree: { sha: "base1" } },
      "git/trees": { sha: "tree2" },
      "git/commits": { sha: "commit2" },
    };

    beforeEach(() => {
      cfg["github.name"] = "Jo";
      cfg["github.email"] = "jo@example.com";
      cfg["github.token"] = "pat123";
      body = (url) =>
        url.startsWith(API) ? gitBodies[url.slice(API.length)] : undefined;
    });

    const run = (selector: string, data: unknown) =>
      threw(() => readService(selector).run(data));
    const batch = (root = ROOT) =>
      run(
        `share:writeBatch:${root.startsWith("github:") ? "github:" : "https://github.com/"}*`,
        {
          root,
          writes: [
            { uri: `${root}/A.md`, content: "a" },
            { uri: `${root}/My%20Notes/C%20D.md`, content: "c" },
          ],
          deletes: [`${root}/Old.md`],
        },
      );

    test("member URIs encode each segment and add .md", async () => {
      for (const root of [ROOT, "https://github.com/me/repo/blob/dev/docs"]) {
        const service = h.services.find(
          (s) =>
            s.selector ===
            `share:target:${root.startsWith("github:") ? "github:" : "https://github.com/"}*`,
        )!;
        const t: any = await service.run({ uri: root });
        expect(await t.memberUri(root, "My Notes/C D")).toBe(
          `${root}/My%20Notes/C%20D.md`,
        );
      }
    });

    const list = (uri: string, extra = {}) =>
      run(
        `net.listURI:${uri.startsWith("github:") ? "github:" : "https://github.com/"}*`,
        { uri, ...extra },
      );

    test("listing maps the root's subtree to member URIs with blob SHAs", async () => {
      for (const root of [ROOT, "https://github.com/me/repo/blob/dev/docs"]) {
        fetches = [];
        body = (url) =>
          url === `${API}git/trees/dev:docs?recursive=1`
            ? {
                tree: [
                  { path: "A.md", type: "blob", sha: "a1" },
                  { path: "My Notes", type: "tree", sha: "t2" },
                  { path: "My Notes/C D.md", type: "blob", sha: "c1" },
                  { path: "logo.png", type: "blob", sha: "p" },
                ],
                truncated: false,
              }
            : undefined;
        expect(await list(root)).toEqual([
          { uri: `${root}/A.md`, hash: "a1" },
          { uri: `${root}/My%20Notes/C%20D.md`, hash: "c1" },
        ]);
        expect(fetches.map((f) => f.url)).toEqual([
          `${API}git/trees/dev:docs?recursive=1`,
        ]);
      }
    });

    test("a nested root's tree is addressed with encoded segments", async () => {
      body = () => ({ tree: [] });
      await list("github:me/repo@dev/My%20Docs/sub");
      expect(fetches[0].url).toBe(
        `${API}git/trees/dev:My%20Docs/sub?recursive=1`,
      );
    });

    test("a repo root lists the whole branch", async () => {
      body = () => ({ tree: [{ path: "A.md", type: "blob", sha: "a1" }] });
      expect(await list("github:me/repo")).toEqual([
        { uri: "github:me/repo/A.md", hash: "a1" },
      ]);
      expect(fetches[0].url).toBe(`${API}git/trees/main?recursive=1`);
    });

    test("a missing branch or repo is an error", async () => {
      status = () => 404;
      expect(await list("github:me/repo")).toBe(
        "THREW GitHub: me/repo@main not found (or not signed in to GitHub)",
      );
      expect(await list(ROOT)).toBe(
        "THREW GitHub: me/repo@dev not found (or not signed in to GitHub)",
      );
    });

    test("a folder not created yet on an existing branch lists nothing", async () => {
      status = (url) => (url.includes("git/trees/") ? 404 : 200);
      // An empty Lua table comes back as {}
      expect(await list(ROOT)).toEqual({});
      expect(fetches.map((f) => f.url)).toEqual([
        `${API}git/trees/dev:docs?recursive=1`,
        `${API}git/ref/heads/dev`,
      ]);
    });

    test("a truncated tree is an error", async () => {
      body = () => ({
        tree: [{ path: "A.md", type: "blob", sha: "a1" }],
        truncated: true,
      });
      expect(await list(ROOT)).toBe(
        `THREW GitHub: too many files under ${ROOT} to list`,
      );
    });

    test("listing signs in only when asked to", async () => {
      delete cfg["github.token"];
      body = () => ({ tree: [] });
      await list(ROOT);
      expect(deviceFlows).toHaveLength(0);
      expect(fetches[0].opts.headers.Authorization).toBeUndefined();
      await list(ROOT, { signIn: true });
      expect(deviceFlows).toHaveLength(1);
      expect(fetches[1].opts.headers.Authorization).toBe("Bearer gho_device");
    });

    test("a publish is one commit with a null sha for each removal", async () => {
      expect(await batch()).toBeUndefined();
      expect(
        fetches.map((f) => `${f.opts.method} ${f.url.replace(API, "")}`),
      ).toEqual([
        "GET git/ref/heads/dev",
        "GET git/commits/head1",
        "POST git/trees",
        "POST git/commits",
        "PATCH git/refs/heads/dev",
      ]);
      // Sent as JSON text so the null survives
      expect(JSON.parse(fetches[2].opts.body)).toEqual({
        base_tree: "base1",
        tree: [
          { path: "docs/A.md", mode: "100644", type: "blob", content: "a" },
          {
            path: "docs/My Notes/C D.md",
            mode: "100644",
            type: "blob",
            content: "c",
          },
          { path: "docs/Old.md", mode: "100644", type: "blob", sha: null },
        ],
      });
      expect(fetches[3].opts.body).toEqual({
        message: "Publish docs",
        tree: "tree2",
        parents: ["head1"],
        author: { name: "Jo", email: "jo@example.com" },
        committer: { name: "Jo", email: "jo@example.com" },
      });
      expect(fetches[4].opts.body).toEqual({ sha: "commit2" });
    });

    test("https://github.com/ roots commit the same way", async () => {
      expect(
        await batch("https://github.com/me/repo/blob/dev/docs"),
      ).toBeUndefined();
      expect(
        JSON.parse(fetches[2].opts.body).tree.map((e: any) => e.path),
      ).toEqual(["docs/A.md", "docs/My Notes/C D.md", "docs/Old.md"]);
    });

    test("a cancelled commit message writes nothing", async () => {
      commitMessage = undefined;
      expect(await batch()).toEqual({ cancelled: true });
      expect(fetches).toHaveLength(0);
    });

    test("a moved branch is reported", async () => {
      status = (_url, opts) => (opts?.method === "PATCH" ? 422 : 200);
      expect(await batch()).toBe(
        "THREW The branch moved while publishing; publish again",
      );
    });
  });
});
