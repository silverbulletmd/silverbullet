import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { collectPagesToReindex } from "./invalidate.ts";
import { indexRelations } from "./relation.ts";

async function indexPage(name: string, text: string) {
  const { parseMarkdown } = await import(
    "../../client/markdown_parser/parser.ts"
  );
  const tree = parseMarkdown(text);
  const objects = await indexRelations(
    {
      ref: name,
      name,
      tag: "page",
      lastModified: "0",
      created: "0",
      perm: "rw",
    },
    {},
    tree,
    text,
  );
  await (globalThis as any).syscall("index.indexObjects", name, objects);
}

test("a page linking the deleted file is found via its resolved path", async () => {
  const { space } = createMockSystem();
  await space.writePage("docs/api/Auth", "");
  await space.writePage("Home", "See [[Auth]]");
  // The relation records the *resolved* target, docs/api/Auth.
  await indexPage("Home", "See [[Auth]]");

  // docs/api/Auth.md is deleted: no candidate lookup returns it anymore, so
  // only its own path leads back to the stale relation.
  await space.deletePage("docs/api/Auth");
  const pages = await collectPagesToReindex(["docs/api/Auth.md"]);
  expect(pages).toContain("Home");
});

test("a folder-to-folder move finds pages via the old resolved path", async () => {
  const { space } = createMockSystem();
  await space.writePage("fred/Zef Hemel", "");
  await space.writePage("Home", "By [[Zef Hemel]]");
  await indexPage("Home", "By [[Zef Hemel]]");

  // The move: old path gone, new path present. The bare link needs no rewrite
  // (that is the feature working), so only invalidation re-points the index.
  await space.deletePage("fred/Zef Hemel");
  await space.writePage("gred/Zef Hemel", "");
  const pages = await collectPagesToReindex([
    "fred/Zef Hemel.md",
    "gred/Zef Hemel.md",
  ]);
  expect(pages).toContain("Home");
});

test("a dangling link's page is found when its target appears", async () => {
  const { space } = createMockSystem();
  await space.writePage("Home", "See [[Auth]]");
  // Indexes an aspiring-page record for the dangling link.
  await indexPage("Home", "See [[Auth]]");

  await space.writePage("docs/api/Auth", "");
  const pages = await collectPagesToReindex(["docs/api/Auth.md"]);
  expect(pages).toContain("Home");
});

test("an unrelated file event re-indexes nothing", async () => {
  const { space } = createMockSystem();
  await space.writePage("docs/api/Auth", "");
  await space.writePage("Home", "See [[Auth]]");
  await indexPage("Home", "See [[Auth]]");

  await space.writePage("Elsewhere/Unrelated", "");
  const pages = await collectPagesToReindex(["Elsewhere/Unrelated.md"]);
  expect(pages.size).toBe(0);
});
