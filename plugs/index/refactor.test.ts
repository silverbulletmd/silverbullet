import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { indexPage } from "./indexer.ts";
import { batchRenameFiles } from "./refactor.ts";

async function indexPageForTest(name: string, text: string) {
  const meta: PageMeta = {
    ref: name,
    tag: "page",
    name,
    perm: "rw",
    lastModified: "2026-08-18T00:00:00Z",
    created: "",
  };
  const tree = parseMarkdown(text);
  await indexPage({ name, tree, meta, text });
}

test("cross-folder rename rewrites only the URL of relative markdown links", async () => {
  const { space, system } = createMockSystem();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });

  const text =
    "See [the target](../Sub/Target) for details, [[Sub/Target]] and [abs](/Sub/Target).";
  await space.writePage("Old/Note", text);
  await indexPageForTest("Old/Note", text);

  const ok = await batchRenameFiles([["Old/Note.md", "Deep/Sub/Note.md"]]);
  expect(ok).toBe(true);

  const { text: newText } = await space.readPage("Deep/Sub/Note");
  expect(newText).toBe(
    "See [the target](../../Sub/Target) for details, [[Sub/Target]] and [abs](/Sub/Target).",
  );
});

test("cross-folder rename leaves an @mention's text byte-identical", async () => {
  const { space, system } = createMockSystem();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });

  await (globalThis as any).syscall("index.indexObjects", "People/Pete Smith", [
    {
      ref: "People/Pete Smith",
      tag: "page",
      name: "People/Pete Smith",
      tags: ["recipient"],
      aliases: ["PeteSmith"],
    },
  ]);

  const text = "Hello @PeteSmith, how are you?";
  await space.writePage("Old/Note", text);
  await indexPageForTest("Old/Note", text);

  const ok = await batchRenameFiles([["Old/Note.md", "New/Note.md"]]);
  expect(ok).toBe(true);

  const { text: newText } = await space.readPage("New/Note");
  expect(newText).toBe(text);
});

test("renaming a recipient page never touches pages that only @mention it", async () => {
  const { space, system } = createMockSystem();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });

  const petePage = "---\ntags: recipient\n---\n\nPete's page.\n";
  await space.writePage("People/Pete Smith", petePage);
  await indexPageForTest("People/Pete Smith", petePage);

  const text = "Hello @PeteSmith, how are you?";
  await space.writePage("Notes", text);
  await indexPageForTest("Notes", text);

  // Mentions are documented as not rewritten on rename, so the mentioning
  // page must not even be written back byte-identically (mtime/sync churn).
  const writes: string[] = [];
  const origSyscall = (globalThis as any).syscall;
  (globalThis as any).syscall = (name: string, ...args: any[]) => {
    if (name === "space.writePage") writes.push(args[0]);
    return origSyscall(name, ...args);
  };
  try {
    const ok = await batchRenameFiles([
      ["People/Pete Smith.md", "People/Pete Jones.md"],
    ]);
    expect(ok).toBe(true);
  } finally {
    (globalThis as any).syscall = origSyscall;
  }

  const { text: newText } = await space.readPage("Notes");
  expect(newText).toBe(text);
  expect(writes).not.toContain("Notes");
});
