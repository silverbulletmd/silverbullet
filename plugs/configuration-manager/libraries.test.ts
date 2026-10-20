import { describe, expect, test } from "vitest";
import { hashSHA256 } from "../../plug-api/lib/crypto.ts";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { extractFrontmatter, patchFrontmatter } from "../index/api.ts";
import { librariesAction } from "./libraries.ts";
import { installTestSyscalls } from "./test_syscalls.ts";

const syscalls = installTestSyscalls();

const URI = "https://example.com/Library/Widgets.md";
const REMOTE_V1 =
  "---\nname: Library/Widgets\ntags: meta/library\n---\nBody one\n";
const REMOTE_V2 =
  "---\nname: Library/Widgets\ntags: meta/library\n---\nBody two\n";

function stub(
  installed: string,
  remote: string,
  store: Record<string, any> = {},
) {
  const written: { name: string; text: string }[] = [];
  syscalls["markdown.parseMarkdown"] = (text: string) => parseMarkdown(text);
  syscalls["system.invokeFunction"] = (fn: string, ...args: any[]) => {
    if (fn === "index.extractFrontmatter") {
      return extractFrontmatter(args[0]);
    }
    if (fn === "index.patchFrontmatter") {
      return patchFrontmatter(args[0], args[1]);
    }
    throw new Error(`Unexpected function: ${fn}`);
  };
  syscalls["space.readPage"] = () => installed;
  syscalls["space.pageExists"] = () => true;
  syscalls["space.writePage"] = (name: string, text: string) => {
    written.push({ name, text });
  };
  syscalls["lua.evalExpression"] = () => remote;
  syscalls["clientStore.get"] = (key: string) => store[key];
  syscalls["clientStore.set"] = (key: string, value: any) => {
    store[key] = value;
  };
  for (const name of ["mq.awaitEmptyQueue", "editor.reloadConfigAndCommands"]) {
    syscalls[name] = () => {};
  }
  return { written, store };
}

function installedPage(remote: string, share: string): string {
  return remote.replace("---\n", `---\n${share}\n`);
}

describe("updating a library", () => {
  test("identical remote is a no-op", async () => {
    const installed = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.mode: pull`,
    );
    const { written, store } = stub(installed, REMOTE_V1);
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: false } });
    expect(written).toEqual([]);
    expect(store).toEqual({});
  });

  test("a legacy share.hash does not block the no-op", async () => {
    const legacy = (await hashSHA256(REMOTE_V1)).slice(0, 8);
    const installed = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.hash: ${legacy}\nshare.mode: pull`,
    );
    const { written } = stub(installed, REMOTE_V1);
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: false } });
    expect(written).toEqual([]);
  });

  test("changed remote is written without a hash and sets the base", async () => {
    const installed = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.hash: 1a2b3c4d\nshare.mode: pull`,
    );
    const { written, store } = stub(installed, REMOTE_V2);
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: true } });
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe("Library/Widgets");
    expect(written[0].text).toContain(URI);
    expect(written[0].text).toContain("mode: pull");
    expect(written[0].text).not.toContain("share.hash");
    expect(written[0].text).toContain("Body two");
    expect(store[`share.base:${URI}`]).toBe(REMOTE_V2);
    expect(store[`share.baseV2:${URI}`]).toBe(true);
  });

  test("force rewrites even when identical", async () => {
    const installed = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.mode: pull`,
    );
    const { written } = stub(installed, REMOTE_V1);
    const result = await librariesAction("update", {
      name: "Library/Widgets",
      force: true,
    });
    expect(result).toEqual({ ok: true, data: { changed: true } });
    expect(written).toHaveLength(1);
  });

  test("a locally edited page is kept when the remote is unchanged since install", async () => {
    const edited = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.mode: pull`,
    ).replace("Body one", "Body one, edited locally");
    const { written } = stub(edited, REMOTE_V1, {
      [`share.base:${URI}`]: REMOTE_V1,
    });
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: false } });
    expect(written).toEqual([]);
  });

  test("a locally edited page is kept with only a legacy hash and no base", async () => {
    const legacy = (await hashSHA256(REMOTE_V1)).slice(0, 8);
    const edited = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.hash: ${legacy}\nshare.mode: pull`,
    ).replace("Body one", "Body one, edited locally");
    const { written } = stub(edited, REMOTE_V1);
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: false } });
    expect(written).toEqual([]);
  });

  test("an edited page is overwritten when the remote changed", async () => {
    const edited = installedPage(
      REMOTE_V1,
      `share.uri: "${URI}"\nshare.mode: pull`,
    ).replace("Body one", "Body one, edited locally");
    const { written } = stub(edited, REMOTE_V2, {
      [`share.base:${URI}`]: REMOTE_V1,
    });
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: true } });
    expect(written[0].text).toContain("Body two");
  });

  test("install then update with an unchanged remote is a no-op", async () => {
    const first = stub("", REMOTE_V1);
    first.written.length = 0;
    syscalls["space.pageExists"] = () => false;
    await librariesAction("install", { uri: URI });
    expect(first.written).toHaveLength(1);
    expect(first.store[`share.baseV2:${URI}`]).toBe(true);
    const installed = first.written[0].text;
    syscalls["space.readPage"] = () => installed;
    const result = await librariesAction("update", { name: "Library/Widgets" });
    expect(result).toEqual({ ok: true, data: { changed: false } });
    expect(first.written).toHaveLength(1);
  });
});
