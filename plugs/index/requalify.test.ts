import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { indexRelations } from "./relation.ts";
import { requalifyCollisions } from "./requalify.ts";

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

test("creating a colliding page requalifies bare links to the older one", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  await space.writePage("Home", "See [[Notes]] here");
  await indexPage("Home", "See [[Notes]] here");

  await space.writePage("bla2/Notes", "");
  await requalifyCollisions("bla2/Notes");

  expect((await space.readPage("Home")).text).toBe("See [[bla/Notes]] here");
});

test("an already-qualified link is left alone", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  await space.writePage("Home", "See [[bla/Notes]] here");
  await indexPage("Home", "See [[bla/Notes]] here");

  await space.writePage("bla2/Notes", "");
  await requalifyCollisions("bla2/Notes");

  expect((await space.readPage("Home")).text).toBe("See [[bla/Notes]] here");
});

test("no collision means no rewrite", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  await space.writePage("Home", "See [[Notes]] here");
  await indexPage("Home", "See [[Notes]] here");

  await space.writePage("bla/Other", "");
  await requalifyCollisions("bla/Other");

  expect((await space.readPage("Home")).text).toBe("See [[Notes]] here");
});

test("requalification is idempotent", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  await space.writePage("Home", "See [[Notes]] here");
  await indexPage("Home", "See [[Notes]] here");

  await space.writePage("bla2/Notes", "");
  await requalifyCollisions("bla2/Notes");
  await requalifyCollisions("bla2/Notes");

  expect((await space.readPage("Home")).text).toBe("See [[bla/Notes]] here");
});

test("an alias and a header suffix survive requalification", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  const text = "See [[Notes#Setup|the notes]] here";
  await space.writePage("Home", text);
  await indexPage("Home", text);

  await space.writePage("bla2/Notes", "");
  await requalifyCollisions("bla2/Notes");

  expect((await space.readPage("Home")).text).toBe(
    "See [[bla/Notes#Setup|the notes]] here",
  );
});

test("a markdown link is left alone during requalification", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  const text = "Wiki [[Notes]] and markdown [notes](./Notes)";
  await space.writePage("Home", text);
  await indexPage("Home", text);

  await space.writePage("bla2/Notes", "");
  await requalifyCollisions("bla2/Notes");

  // The wiki link is pinned; the markdown link keeps its own semantics.
  expect((await space.readPage("Home")).text).toBe(
    "Wiki [[bla/Notes]] and markdown [notes](./Notes)",
  );
});

test("a routine save of a long-colliding page does not requalify", async () => {
  const { space } = createMockSystem();
  // The collision already exists (as if it arrived via sync or git)...
  await space.writePage("bla/Notes", "");
  await space.writePage("bla2/Notes", "existing content");
  await space.writePage("Home", "See [[Notes]] here");
  await indexPage("Home", "See [[Notes]] here");

  // ...and the user merely edits one of the colliding pages.
  const { requalifyAfterSave } = await import("./requalify.ts");
  await requalifyAfterSave("bla2/Notes", {}, false);

  expect((await space.readPage("Home")).text).toBe("See [[Notes]] here");
});

test("a creating save requalifies bare links in every affected page", async () => {
  const { space } = createMockSystem();
  await space.writePage("bla/Notes", "");
  await space.writePage("Home", "See [[Notes]] and [[Notes]] again");
  await space.writePage("Other", "Also [[Notes]]");
  await indexPage("Home", "See [[Notes]] and [[Notes]] again");
  await indexPage("Other", "Also [[Notes]]");

  await space.writePage("bla2/Notes", "");
  const { requalifyAfterSave } = await import("./requalify.ts");
  await requalifyAfterSave("bla2/Notes", {}, true);

  expect((await space.readPage("Home")).text).toBe(
    "See [[bla/Notes]] and [[bla/Notes]] again",
  );
  expect((await space.readPage("Other")).text).toBe("Also [[bla/Notes]]");
});

test("with shortest-suffix, requalified links get the minimal suffix", async () => {
  const { space, config } = createMockSystem();
  config.set("linkWriteFormat", "shortest-suffix");
  await space.writePage("docs/api/Notes", "");
  await space.writePage("Home", "See [[Notes]] here");
  await indexPage("Home", "See [[Notes]] here");

  await space.writePage("sibling/Notes", "");
  const { requalifyAfterSave } = await import("./requalify.ts");
  await requalifyAfterSave("sibling/Notes", {}, true);

  expect((await space.readPage("Home")).text).toBe("See [[api/Notes]] here");
});
