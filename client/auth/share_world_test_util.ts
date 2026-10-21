import { createHash } from "node:crypto";
import { renderToText } from "../../plug-api/lib/tree.ts";
import { applyPatches, type YamlPatch } from "../../plug-api/lib/yaml.ts";
import {
  extractFrontMatter,
  patchFrontmatterText,
} from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
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

type Response = {
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
  mergeText: (base: string, local: string, remote: string) => unknown = () => {
    throw new Error("unexpected merge");
  };
  merges: Array<[string, string, string]> = [];
  // Remote of the non-SilverBullet test transport
  other = new Map<string, string>();
  beforePut: (() => void) | undefined;
  notifications: Array<[string, string | undefined]> = [];
  confirms: string[] = [];
  confirmAnswer = true;
  // editor.chooseVersion calls, and the choice id it returns (nil: cancelled)
  chooseVersions: Array<Record<string, unknown>> = [];
  chooseAnswer: string | undefined;
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
  h!: StdPageHarness;

  static async create({ github = false } = {}): Promise<ShareWorld> {
    const world = new ShareWorld();
    world.withGithub = github;
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

  /** Loads the pages afresh (keeping the store), e.g. a new device */
  load(): Promise<StdPageHarness> {
    return loadStdPages(
      this.withGithub ? [...PAGES, GITHUB_PAGE] : PAGES,
      {
        print: () => undefined,
        schema: { string: () => ({ type: "string" }) },
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
          mergeText: (base: string, local: string, remote: string) => {
            this.merges.push([base, local, remote]);
            return this.mergeText(base, local, remote);
          },
        },
        editor: {
          getText: () => this.editorText,
          getCurrentPage: () => "Page",
          setText: (text: string) => {
            this.editorText = text;
          },
          prompt: () => "Page",
          filterBox: (
            label: string,
            options: Array<Record<string, unknown>>,
          ) =>
            label === "Share provider"
              ? options.find((o) => o.name === this.shareProvider)
              : options.find((o) => o.name === SPACE),
          confirm: (msg: string) => {
            this.confirms.push(msg);
            return this.confirmAnswer;
          },
          chooseVersion: (options: Record<string, unknown>) => {
            this.chooseVersions.push(options);
            return this.chooseAnswer;
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
          proxyFetch: (url: string, opts: any) => {
            this.fetches.push({ url, opts });
            const r = this.fsHandler(url, opts);
            return {
              ok: true,
              status: r.status,
              headers: r.headers ?? {},
              body: r.body ?? null,
            };
          },
        },
      },
      { store: this.store, config: this.cfg },
    );
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

  /** Page "Page" last shared at `base`, now `local` here and `remote` there.
   * `legacyHash` seeds the share.hash older versions wrote for `base`. */
  async setup(
    base: string,
    local: string,
    remoteText: string,
    { mode = "sync", storeBase = true, uri = URI, legacyHash = false } = {},
  ) {
    const m: Record<string, string> = { uri, mode };
    let text = (await this.h.call("share.setFrontmatter", m, local)) as string;
    if (legacyHash) {
      const hash = (await this.h.call("share.legacyHash", base)) as string;
      text = patchFrontmatterText(text, parseMarkdown(text), (yaml) =>
        applyPatches(yaml, [
          { op: "set-key", path: "share.hash", value: hash },
        ]),
      );
    }
    this.pages.set("Page", text);
    this.setRemote("Page", remoteText);
    if (storeBase) {
      this.store.set(`share.base:${uri}`, base);
    }
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
