import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { updateBacklinks } from "./refactor.ts";
import { indexRelations } from "./relation.ts";

async function indexPage(name: string, text: string) {
  const objects = await indexRelations(
    {
      ref: name,
      name,
      tag: "page",
      lastModified: "0",
      created: "0",
      perm: "rw",
    } as any,
    {},
    parseMarkdown(text),
    text,
  );
  await (globalThis as any).syscall("index.indexObjects", name, objects);
}

test("moving a page to a folder leaves a unique bare link untouched", async () => {
  const { space } = createMockSystem();
  await space.writePage("Zef Hemel", "The person");
  const text = "Written by [[Zef Hemel]].";
  await space.writePage("Mentions", text);
  await indexPage("Mentions", text);

  // What renamePage does: write the new path, drop the old, fix backlinks.
  await space.writePage("fred/Zef Hemel", "The person");
  await space.deletePage("Zef Hemel");
  await updateBacklinks("Zef Hemel", "fred/Zef Hemel");

  expect((await space.readPage("Mentions")).text).toBe(text);
});

test("the old path never counts as a rival when deciding the write format", async () => {
  const { space } = createMockSystem();
  await space.writePage("Zef Hemel", "The person");
  const text = "Written by [[Zef Hemel]].";
  await space.writePage("Mentions", text);
  await indexPage("Mentions", text);

  // Same rename, but the delete has not landed yet: the answer must not change.
  await space.writePage("fred/Zef Hemel", "The person");
  await updateBacklinks("Zef Hemel", "fred/Zef Hemel");

  expect((await space.readPage("Mentions")).text).toBe(text);
});

test("with shortest-suffix, a rename into a collision writes the suffix", async () => {
  const { space, config } = createMockSystem();
  config.set("linkWriteFormat", "shortest-suffix");
  await space.writePage("Notes", "The page");
  await space.writePage("sibling/Notes", "The rival");
  const text = "See [[Notes]].";
  await space.writePage("Mentions", text);
  await indexPage("Mentions", text);

  await space.writePage("docs/api/Notes", "The page");
  await space.deletePage("Notes");
  await updateBacklinks("Notes", "docs/api/Notes");

  expect((await space.readPage("Mentions")).text).toBe("See [[api/Notes]].");
});
