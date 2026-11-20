import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import YAML from "js-yaml";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { indexPage } from "./indexer.ts";
import { batchRenameFiles } from "./refactor.ts";
import { requalifyAfterSave } from "./requalify.ts";
import { applySplices, type Splice, yamlRegions } from "./refactor_yaml.ts";

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

/** Indexes queued pages in the background, as the client's index queue
 * consumer does; `costMs` stands in for the time real indexing takes. */
function startIndexWorker(
  { mq, space }: ReturnType<typeof createMockSystem>,
  costMs = 0,
) {
  return mq.subscribe(
    "indexQueue",
    { batchSize: 10, pollInterval: 50 },
    async (messages) => {
      await new Promise((resolve) => setTimeout(resolve, costMs));
      for (const { body } of messages) {
        const path = typeof body === "string" ? body : body.path;
        if (!path.endsWith(".md")) continue;
        const name = path.slice(0, -3);
        try {
          await indexPageForTest(name, (await space.readPage(name)).text);
        } catch {
          // Deleted since it was queued
        }
      }
      await mq.batchAck(
        "indexQueue",
        messages.map((m) => m.id),
      );
    },
  );
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

test("moving a page rewrites links to its moved image and moves the image back with the page", async () => {
  const { space, system } = createMockSystem();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });

  const original = "![[Inbox/photo.jpg]] and ![image](photo.jpg)";
  await space.writePage("Inbox/sample", original);
  await space.writeDocument("Inbox/photo.jpg", new Uint8Array([1, 2, 3]));
  await indexPageForTest("Inbox/sample", original);

  expect(
    await batchRenameFiles([["Inbox/sample.md", "Journal/2026/09/sample.md"]]),
  ).toBe(true);
  const moved = (await space.readPage("Journal/2026/09/sample")).text;
  expect(moved).toBe("![[Journal/2026/09/photo.jpg]] and ![image](photo.jpg)");
  expect(
    (await (globalThis as any).syscall("space.listDocuments")).map(
      (doc: { name: string }) => doc.name,
    ),
  ).toEqual(["Journal/2026/09/photo.jpg"]);

  await indexPageForTest("Journal/2026/09/sample", moved);
  expect(
    await batchRenameFiles([["Journal/2026/09/sample.md", "Inbox/sample.md"]]),
  ).toBe(true);
  expect((await space.readPage("Inbox/sample")).text).toBe(original);
  expect(
    (await (globalThis as any).syscall("space.listDocuments")).map(
      (doc: { name: string }) => doc.name,
    ),
  ).toEqual(["Inbox/photo.jpg"]);
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

test("renaming a page rewrites links inside frontmatter text", async () => {
  const { space, system } = createMockSystem();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });

  await space.writePage("Person/Alice", "Alice");
  await indexPageForTest("Person/Alice", "Alice");
  const notes =
    '---\nnote: "ask [[Person/Alice]] and [[Person/Alice|her]] first"\nrefs:\n- "via [[Person/Alice]]"\n- plain [[Person/Alice]]\nsummary: plain [[Person/Alice]] too\n---\nBody\n';
  await space.writePage("Notes", notes);
  await indexPageForTest("Notes", notes);

  const ok = await batchRenameFiles([["Person/Alice.md", "People/Alice.md"]]);
  expect(ok).toBe(true);

  const { text } = await space.readPage("Notes");
  expect(text).toBe(
    '---\nnote: "ask [[People/Alice]] and [[People/Alice|her]] first"\nrefs:\n- "via [[People/Alice]]"\n- plain [[People/Alice]]\nsummary: plain [[People/Alice]] too\n---\nBody\n',
  );
});

async function renameAliceIn(page: string, newName: string): Promise<string> {
  const { space, system } = createMockSystem();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });
  await space.writePage("Person/Alice", "Alice");
  await indexPageForTest("Person/Alice", "Alice");
  await space.writePage("Notes", page);
  await indexPageForTest("Notes", page);
  expect(await batchRenameFiles([["Person/Alice.md", `${newName}.md`]])).toBe(
    true,
  );
  return (await space.readPage("Notes")).text;
}

test("rename keeps a single-quoted frontmatter value valid when the new name has an apostrophe", async () => {
  const text = await renameAliceIn(
    "---\nnote: 'see [[Person/Alice]] first'\nref: '[[Person/Alice]]'\n---\nBody\n",
    "People/Alice's Notes",
  );
  expect(text).toBe(
    "---\nnote: 'see [[People/Alice''s Notes]] first'\nref: '[[People/Alice''s Notes]]'\n---\nBody\n",
  );
});

test("rename re-quotes a plain frontmatter value that the new name would break", async () => {
  const text = await renameAliceIn(
    "---\nsummary: plain [[Person/Alice]] and [[Person/Alice|her]] too\n---\nBody\n",
    "People/Meeting: Q3",
  );
  expect(text).toBe(
    '---\nsummary: "plain [[People/Meeting: Q3]] and [[People/Meeting: Q3|her]] too"\n---\nBody\n',
  );
});

test("rename keeps frontmatter list items valid", async () => {
  const text = await renameAliceIn(
    "---\nrefs:\n- 'via [[Person/Alice]]'\n- plain [[Person/Alice]]\n---\nBody\n",
    "People/Bob's Meeting: Q3",
  );
  expect(text).toBe(
    "---\nrefs:\n- 'via [[People/Bob''s Meeting: Q3]]'\n- \"plain [[People/Bob's Meeting: Q3]]\"\n---\nBody\n",
  );
});

test("rename leaves frontmatter values that stay valid byte-identical apart from the link", async () => {
  const text = await renameAliceIn(
    '---\nnote: "see [[Person/Alice]]"  # keep\nplain: x [[Person/Alice]]\nref: "[[Person/Alice]]"\n---\nBody\n',
    "People/Alice's Notes",
  );
  expect(text).toBe(
    '---\nnote: "see [[People/Alice\'s Notes]]"  # keep\nplain: x [[People/Alice\'s Notes]]\nref: "[[People/Alice\'s Notes]]"\n---\nBody\n',
  );
});

test("rename keeps a trailing comment when it re-quotes a value", async () => {
  const text = await renameAliceIn(
    "---\nplain: x [[Person/Alice]] # why\nsingle: 'see [[Person/Alice]]'   # keep\ndouble: \"[[Person/Alice]]\" # same\nlist:\n- plain [[Person/Alice]]  # item\n---\nBody\n",
    "People/Bob's Meeting: Q3",
  );
  expect(text).toBe(
    "---\nplain: \"x [[People/Bob's Meeting: Q3]]\" # why\nsingle: 'see [[People/Bob''s Meeting: Q3]]'   # keep\ndouble: \"[[People/Bob's Meeting: Q3]]\" # same\nlist:\n- \"plain [[People/Bob's Meeting: Q3]]\"  # item\n---\nBody\n",
  );
});

describe("rename never corrupts a YAML block", () => {
  const body = "\nBody [[Person/Alice]]\n";
  const cases: [string, string][] = [
    ["a flow sequence", "refs: ['[[Person/Alice]]', 'x']"],
    ["a multi-line quoted scalar", "note: 'see [[Person/Alice]]\n  more'"],
    [
      "a plain scalar with a continuation line",
      "note: see [[Person/Alice]]\n  and more",
    ],
  ];
  for (const [name, yaml] of cases) {
    test(`${name} stays valid`, async () => {
      const text = await renameAliceIn(
        `---\n${yaml}\n---${body}`,
        "People/Bob's Meeting: Q3",
      );
      const m = /^---\n([\s\S]*)\n---/.exec(text)!;
      expect(YAML.load(m[1])).toEqual(YAML.load(yaml));
      // The rest of the page is still renamed
      expect(text.endsWith("Body [[People/Bob's Meeting: Q3]]\n")).toBe(true);
    });
  }

  test("a normal value is still renamed", async () => {
    const text = await renameAliceIn(
      `---\nref: '[[Person/Alice]]'\n---${body}`,
      "People/Bob's Meeting: Q3",
    );
    expect(text).toBe(
      "---\nref: '[[People/Bob''s Meeting: Q3]]'\n---\nBody [[People/Bob's Meeting: Q3]]\n",
    );
  });
});

test("rename keeps data block values valid and leaves body text alone", async () => {
  const text = await renameAliceIn(
    "```#contact\nname: Bob\nnote: 'met [[Person/Alice]]'\n```\nnote: 'see [[Person/Alice]]'\n",
    "People/Alice's Notes",
  );
  expect(text).toBe(
    "```#contact\nname: Bob\nnote: 'met [[People/Alice''s Notes]]'\n```\nnote: 'see [[People/Alice's Notes]]'\n",
  );
});

test("applySplices counts only the splices it kept", () => {
  const text = "---\nrefs: ['[[A]]', 'x']\n---\nBody [[A]]\n";
  const splice = (at: number): Splice => ({
    range: [at, at + "[[A]]".length],
    apply: (t) => `${t.slice(0, at)}[[B's: C]]${t.slice(at + "[[A]]".length)}`,
  });
  const result = applySplices(
    text,
    [splice(text.indexOf("[[A]]")), splice(text.lastIndexOf("[[A]]"))],
    yamlRegions(parseMarkdown(text)),
  );
  // The flow sequence can't hold the new name, so its splice is dropped
  expect(result.text).toBe("---\nrefs: ['[[A]]', 'x']\n---\nBody [[B's: C]]\n");
  expect(result.changed).toBe(1);
});

test("moving a page to another folder keeps bare and suffix links pointing at it", async () => {
  const mock = createMockSystem();
  const { space, system, eventHook, spacePrimitives } = mock;
  await spacePrimitives.enable();
  const worker = startIndexWorker(mock);
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });
  // As in the index plug: a write that creates a page requalifies collisions
  eventHook.addLocalListener("page:saved", requalifyAfterSave);

  await space.writePage("Old/Group/Target", "# Target\n");
  const bare = "See [[Target]] and [[Group/Target]].";
  await space.writePage("Notes/Bare", bare);
  await indexPageForTest("Notes/Bare", bare);

  const ok = await batchRenameFiles([
    ["Old/Group/Target.md", "New/Group/Target.md"],
  ]);
  expect(ok).toBe(true);

  // The moved page keeps its name, so the brief moment both copies exist is
  // not a collision to requalify: the links must follow the page (written in
  // the default full-path format), never freeze onto the old one.
  expect((await space.readPage("Notes/Bare")).text).toBe(
    "See [[New/Group/Target]] and [[Group/Target]].",
  );
  worker.stop();
});

test("a rename that creates a real name collision still requalifies the other page's links", async () => {
  const mock = createMockSystem();
  const { space, system, eventHook, spacePrimitives } = mock;
  await spacePrimitives.enable();
  const worker = startIndexWorker(mock);
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });
  eventHook.addLocalListener("page:saved", requalifyAfterSave);

  await space.writePage("C/Notes", "# Notes\n");
  await space.writePage("A/Foo", "# Foo\n");
  const home = "See [[Notes]].";
  await space.writePage("Home", home);
  await indexPageForTest("Home", home);

  expect(await batchRenameFiles([["A/Foo.md", "B/Notes.md"]])).toBe(true);

  // B/Notes is new to the name, so links that meant C/Notes are qualified
  expect((await space.readPage("Home")).text).toBe("See [[C/Notes]].");
  worker.stop();
});

test("a rename waits for the index to catch up with files changed outside the editor", async () => {
  const mock = createMockSystem();
  const { space, system, eventHook, spacePrimitives, mq } = mock;
  await spacePrimitives.enable();
  system.registerSyscalls([], {
    "editor.save": () => {},
    "editor.getCurrentPage": () => "Unrelated/Page",
    "editor.getCurrentPath": () => "Unrelated/Page",
    "editor.flashNotification": () => {},
    "editor.navigate": () => {},
  });
  // As in the client: a listing that finds changed files queues them, and a
  // worker indexes them in the background
  eventHook.addLocalListener("file:changedBatch", (changed: any[]) =>
    mq.batchSend(
      "indexQueue",
      changed.map(({ name }) => ({ path: name })),
    ),
  );
  // Indexing a real batch of changes takes longer than a rename's lookup
  const worker = startIndexWorker(mock, 300);

  try {
    await space.writePage("Old/Target", "# Target\n");
    await space.fetchPageList();
    await mq.awaitEmptyQueue("indexQueue");

    // Written behind the editor's back (a git pull, another tool): only the
    // next file listing notices it
    const linking = "See [[Old/Target]].";
    await (spacePrimitives as any).wrapped.writeFile(
      "Notes/Linking.md",
      new TextEncoder().encode(linking),
    );

    expect(await batchRenameFiles([["Old/Target.md", "New/Target.md"]])).toBe(
      true,
    );
    expect((await space.readPage("Notes/Linking")).text).toBe(
      "See [[New/Target]].",
    );
  } finally {
    worker.stop();
  }
});
