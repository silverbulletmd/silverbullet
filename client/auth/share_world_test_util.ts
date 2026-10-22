import { createHash } from "node:crypto";
import { renderToText } from "../../plug-api/lib/tree.ts";
import { applyPatches, type YamlPatch } from "../../plug-api/lib/yaml.ts";
import {
  extractFrontMatter,
  patchFrontmatterText,
} from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { ArrayQueryCollection } from "../space_lua/query_collection.ts";
import { jsToLuaValue } from "../space_lua/runtime.ts";
import {
  loadStdPages,
  type StdPageHarness,
} from "../space_lua/std_page_harness_test_util.ts";

// Real runtime order: higher priority first (Auth.md and Share.md are both 10)
const PAGES = [
  "libraries/Library/Std/Infrastructure/Auth.md",
  "libraries/Library/Std/Infrastructure/Share.md",
  "libraries/Library/Std/Infrastructure/SilverBullet Share.md",
  "libraries/Library/Std/Infrastructure/Share Transforms.md",
  "libraries/Library/Std/Infrastructure/Share Collections.md",
  "libraries/Library/Std/Infrastructure/Share Commands.md",
];

const GITHUB_PAGE = "libraries/Library/Std/Infrastructure/Github.md";

export const SPACE = "https://h/n";
export const URI = `${SPACE}/Page`;
export const FS = `${SPACE}/.fs/Page.md`;
// Served by a non-SilverBullet test transport
export const OTHER = "test://other/Page.md";
const KEY = `sb:${SPACE}`;

export const sha256 = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export type Response = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

/**
 * Share.md and SilverBullet Share.md loaded against a fake world: a local
 * space with one page ("Page"), the SilverBullet space SPACE serving it over
 * `.fs` (with ETags, sign-in and token refresh), a non-SilverBullet transport
 * for OTHER, and a recording editor. Starts connected to SPACE.
 */
export class ShareWorld {
  cfg: Record<string, unknown> = {};
  store = new Map<string, any>();
  pages = new Map<string, string>();
  remote = new Map<string, { text: string; etag: string }>();
  etagCounter = 0;
  fetches: Array<{ url: string; opts: any }> = [];
  // Remote of the non-SilverBullet test transport
  other = new Map<string, string>();
  // Whether the test transport offers net.listURI
  otherListable = true;
  beforePut: (() => void) | undefined;
  notifications: Array<[string, string | undefined]> = [];
  confirms: string[] = [];
  openedUrls: string[] = [];
  clipboard: string[] = [];
  confirmAnswer = true;
  // editor.chooseVersion calls, and the choice id it returns (nil: cancelled)
  chooseVersions: Array<Record<string, unknown>> = [];
  chooseAnswer: string | undefined;
  // editor.pickMany calls, and the ids it returns (nil: cancelled)
  pickManys: Array<Record<string, unknown>> = [];
  pickManyAnswer: string[] | undefined;
  // Current page as the editor sees it, for the Share: Page command
  editorText = "";
  deviceFlows: unknown[] = [];
  deviceFlowError: string | undefined;
  configWrites: Array<{ path: string; value: unknown }> = [];
  // Served by the runtime's generic https: reader (not a Std page)
  genericReads = new Map<string, string>();
  genericReadCount = 0;
  // The remote space rejects requests without a token
  requireAuth = false;
  // The remote space's token endpoint accepts refresh tokens
  refreshWorks = false;
  // Picked in Share: Page's provider list
  shareProvider = "SilverBullet space";
  // Picked in Share: Collection's list (nil: cancelled)
  collectionPick: string | undefined;
  // Page metadata as the index would return it, by page name
  pageMetas = new Map<string, Record<string, unknown>>();
  // Recording fakes for markdown.bakeSections / expandMarkdown, in call order
  markdownCalls: Array<{
    fn: string;
    text: string;
    pageName?: string;
    options?: any;
  }> = [];
  expandMarkdown: (text: string) => string = (text) => text;
  // Also load Github.md (kept out of PAGES so the sync tests' services stay put)
  withGithub = false;
  // Std pages loaded after the share pages, and the globals they need
  extraPages: string[] = [];
  extraGlobals: Record<string, unknown> = {};
  // editor.invokeCommand calls: [name, args]
  invokedCommands: Array<[string, unknown]> = [];
  navigations: string[] = [];
  // Answers requests to other hosts (e.g. GitHub's API) when it returns one
  fetchHandler: ((url: string, opts: any) => Response | undefined) | undefined;
  h!: StdPageHarness;

  static async create({
    github = false,
    pages = [] as string[],
    globals = {} as Record<string, unknown>,
  } = {}): Promise<ShareWorld> {
    const world = new ShareWorld();
    world.withGithub = github;
    world.extraPages = pages;
    world.extraGlobals = globals;
    world.connect();
    world.h = await world.load();
    return world;
  }

  setRemote(page: string, text: string) {
    this.remote.set(page, { text, etag: `"e${++this.etagCounter}"` });
  }

  private fsHandler(url: string, opts: any): Response {
    if (url === `${SPACE}/.auth/token`) {
      return this.refreshWorks
        ? {
            status: 200,
            body: { access_token: "refreshed", expires_in: 3600 },
          }
        : { status: 400 };
    }
    if (url.endsWith("/.ping")) {
      return url === `${SPACE}/.ping`
        ? { status: 200, headers: { "x-server-version": "2.12.1" } }
        : { status: 404 };
    }
    if (url === `${SPACE}/.fs`) {
      return {
        status: 200,
        body: [...this.remote.keys()].map((name) => ({
          name: `${name}.md`,
          lastModified: 1,
        })),
      };
    }
    const page = decodeURIComponent(
      url.slice(`${SPACE}/.fs/`.length).replace(/\.md$/, ""),
    );
    if (this.requireAuth && !opts?.headers?.Authorization) {
      return { status: 401 };
    }
    const method = opts?.method ?? "GET";
    if (method === "PUT") {
      this.beforePut?.();
      const current = this.remote.get(page);
      const ifMatch = opts.headers?.["If-Match"];
      if (ifMatch && current && ifMatch !== current.etag) {
        return { status: 412 };
      }
      this.setRemote(page, opts.body);
      return { status: 200, headers: { etag: this.remote.get(page)!.etag } };
    }
    const current = this.remote.get(page);
    if (!current) {
      return { status: 404 };
    }
    if (method === "DELETE") {
      this.remote.delete(page);
      return { status: 200 };
    }
    return { status: 200, headers: { etag: current.etag }, body: current.text };
  }

  // Like net.readURI / net.writeURI: invoke the best matching service
  private async invokeBestMatch(selector: string, data: unknown) {
    const matches = (await this.h.call("service.discover", selector, data)) as
      | Array<Record<string, unknown>>
      | undefined;
    if (!matches?.length) {
      const uri = (data as { uri: string }).uri;
      if (uri.startsWith("test://other/")) {
        if (selector.startsWith("net.writeURI:")) {
          this.other.set(uri, (data as { content: string }).content);
          return;
        }
        return this.other.get(uri);
      }
      if (selector.startsWith("net.readURI:") && this.genericReads.has(uri)) {
        this.genericReadCount++;
        return this.genericReads.get(uri);
      }
      throw new Error(`No services matching: ${selector}`);
    }
    return this.h.call("service.invoke", matches[0], data);
  }

  /** Sets config key to the value of a Lua expression (e.g. functions) */
  async luaConfig(key: string, expr: string) {
    const define = (await this.h.call(
      "load",
      `__luaConfig = ${expr}`,
    )) as () => Promise<unknown>;
    await define();
    this.cfg[key] = this.h.env.get("__luaConfig");
  }

  // Page objects of w.pages, as the index would return them
  private pageObjects() {
    return [...this.pages].map(([name, text]) => {
      const frontmatter = extractFrontMatter(parseMarkdown(text));
      const tags = frontmatter.tags;
      return {
        ...frontmatter,
        name,
        tags: tags === undefined ? [] : [tags].flat(),
      };
    });
  }

  // The test transport's list and delete, as services so they can be
  // discovered
  private otherServices(h: StdPageHarness) {
    const listable = () => (this.otherListable ? {} : null);
    h.services.push(
      {
        selector: "net.listURI:test://other/*",
        match: listable,
        run: async (data) => {
          const root = `${(data as { uri: string }).uri.replace(/\/$/, "")}/`;
          return [...this.other.keys()]
            .filter((uri) => uri.startsWith(root))
            .map((uri) => ({ uri }));
        },
        id: "test-other-list",
      },
      {
        selector: "net.deleteURI:test://other/*",
        match: {},
        run: async (data) => {
          this.other.delete((data as { uri: string }).uri);
        },
        id: "test-other-delete",
      },
    );
    return h;
  }

  /** Loads the pages afresh (keeping the store), e.g. a new device */
  async load(): Promise<StdPageHarness> {
    const h = await loadStdPages(
      [...PAGES, ...(this.withGithub ? [GITHUB_PAGE] : []), ...this.extraPages],
      {
        ...this.extraGlobals,
        print: () => undefined,
        schema: {
          string: () => ({ type: "string" }),
          func: () => ({}),
        },
        system: {
          invokeFunction: (_fn: string, path: string, value: unknown) => {
            this.configWrites.push({ path, value });
          },
        },
        index: {
          extractFrontmatter: (text: string) => ({
            frontmatter: extractFrontMatter(parseMarkdown(text)),
            text,
          }),
          patchFrontmatter: (text: string, patches: YamlPatch[]) =>
            patchFrontmatterText(text, parseMarkdown(text), (yaml) =>
              applyPatches(yaml, patches),
            ),
          // Page objects of w.pages; only the "page" tag, query ignored
          queryLuaObjects: (tag: string) =>
            tag === "page" ? this.pageObjects() : [],
          // A query collection, as the real index returns (not an array)
          contentPages: (tag?: string) =>
            new ArrayQueryCollection(
              this.pageObjects()
                .filter((p) => tag === undefined || p.tags.includes(tag))
                .map(jsToLuaValue),
            ),
        },
        markdown: {
          parseMarkdown: (text: string) => parseMarkdown(text),
          renderParseTree: (tree: Parameters<typeof renderToText>[0]) =>
            renderToText(tree),
          bakeSections: (text: string, pageName?: string) => {
            this.markdownCalls.push({ fn: "bakeSections", text, pageName });
            return text;
          },
          expandMarkdown: (text: string, options: unknown) => {
            this.markdownCalls.push({ fn: "expandMarkdown", text, options });
            return this.expandMarkdown(text);
          },
        },
        space: {
          getPageMeta: (name: string) => {
            const meta = this.pageMetas.get(name);
            if (!meta) throw new Error(`Page not found: ${name}`);
            return meta;
          },
          readPage: (name: string) => this.pages.get(name),
          pageExists: (name: string) => this.pages.has(name),
          writePage: (name: string, text: string) =>
            void this.pages.set(name, text),
        },
        editor: {
          getText: () => this.editorText,
          getCurrentPage: () => "Page",
          setText: (text: string) => {
            this.editorText = text;
          },
          prompt: () => "Page",
          openUrl: (url: string) => {
            this.openedUrls.push(url);
          },
          copyToClipboard: (text: string) => {
            this.clipboard.push(text);
          },
          invokeCommand: (name: string, args?: unknown) => {
            this.invokedCommands.push([name, args ?? null]);
          },
          navigate: (name: string) => {
            this.navigations.push(name);
          },
          filterBox: (
            label: string,
            options: Array<Record<string, unknown>>,
          ) => {
            if (label === "Collection") {
              return options.find((o) => o.name === this.collectionPick);
            }
            return label === "Share provider"
              ? options.find((o) => o.name === this.shareProvider)
              : options.find((o) => o.name === SPACE);
          },
          confirm: (msg: string) => {
            this.confirms.push(msg);
            return this.confirmAnswer;
          },
          chooseVersion: (options: Record<string, unknown>) => {
            this.chooseVersions.push(options);
            return this.chooseAnswer;
          },
          pickMany: (options: Record<string, unknown>) => {
            this.pickManys.push(options);
            return jsToLuaValue(this.pickManyAnswer);
          },
          flashNotification: (msg: string, type?: string) => {
            this.notifications.push([msg, type]);
          },
        },
        oauth: {
          deviceFlow: (opts: unknown) => {
            this.deviceFlows.push(opts);
            if (this.deviceFlowError) throw new Error(this.deviceFlowError);
            return { access_token: `access${this.deviceFlows.length}` };
          },
        },
        net: {
          readURI: (uri: string, options: Record<string, unknown> = {}) =>
            this.invokeBestMatch(`net.readURI:${uri}`, { ...options, uri }),
          writeURI: (
            uri: string,
            content: string,
            options: Record<string, unknown> = {},
          ) =>
            this.invokeBestMatch(`net.writeURI:${uri}`, {
              ...options,
              uri,
              content,
            }),
          // Like the real one: nil when no service can list
          listURI: async (
            uri: string,
            options: Record<string, unknown> = {},
          ) => {
            const data = { ...options, uri };
            const matches = (await this.h.call(
              "service.discover",
              `net.listURI:${uri}`,
              data,
            )) as Array<Record<string, unknown>> | undefined;
            if (!matches?.length) return null;
            return jsToLuaValue(
              await this.h.call("service.invoke", matches[0], data),
            );
          },
          deleteURI: (uri: string, options: Record<string, unknown> = {}) =>
            this.invokeBestMatch(`net.deleteURI:${uri}`, { ...options, uri }),
          proxyFetch: (url: string, opts: any) => {
            this.fetches.push({ url, opts });
            const r =
              this.fetchHandler?.(url, opts) ?? this.fsHandler(url, opts);
            return {
              ok: r.status >= 200 && r.status < 300,
              status: r.status,
              headers: r.headers ?? {},
              body: r.body ?? null,
            };
          },
        },
      },
      { store: this.store, config: this.cfg },
    );
    return this.otherServices(h);
  }

  /** The stored credential for SPACE (all live in one store entry) */
  stored() {
    return this.store.get("credentials")?.[KEY];
  }

  storeCredential(cred: Record<string, unknown>) {
    this.store.set("credentials", { [KEY]: { provider: "sb", ...cred } });
  }

  connect() {
    this.storeCredential({ access_token: "token" });
  }

  expiredCredential() {
    this.storeCredential({
      access_token: "old",
      refresh_token: "r",
      expires_at: 1,
      space: SPACE,
    });
  }

  /** New device: SPACE is known from config, but there's no credential here,
   * and the remote rejects anonymous requests. */
  async newDevice() {
    this.store = new Map();
    this.cfg["share.silverbullet.spaces"] = [SPACE];
    this.requireAuth = true;
    this.h = await this.load();
  }

  /** Page "Page" last shared at `last`, now `local` here and `remote` there.
   * `hash` (the default) records `last` in the page's share.hash. */
  async setup(
    last: string,
    local: string,
    remoteText: string,
    { mode = "sync", hash = true, uri = URI } = {},
  ) {
    const m: Record<string, string> = { uri, mode };
    let text = (await this.h.call("share.setFrontmatter", m, local)) as string;
    if (hash) {
      const value = (await this.h.call("share.legacyHash", last)) as string;
      text = patchFrontmatterText(text, parseMarkdown(text), (yaml) =>
        applyPatches(yaml, [{ op: "set-key", path: "share.hash", value }]),
      );
    }
    this.pages.set("Page", text);
    this.setRemote("Page", remoteText);
  }

  async localBody(): Promise<string> {
    return (await this.h.call(
      "share.cleanFrontmatter",
      this.pages.get("Page"),
    )) as string;
  }

  localShare(): Record<string, string> {
    return extractFrontMatter(parseMarkdown(this.pages.get("Page")!))
      .share as Record<string, string>;
  }

  methods(): string[] {
    return this.fetches.map((f) => f.opts?.method ?? "GET");
  }

  // Errors as strings: Lua error objects don't survive vitest's reporting
  sharePage(): Promise<unknown> {
    return this.h
      .call("share.sharePage", "Page")
      .catch((e) => `THREW ${e.message}`);
  }
}
