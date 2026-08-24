import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import {
  atMentionComplete,
  buildRecipientRegistry,
  deriveAliasNickname,
  deriveNickname,
  frontmatterRecipientComplete,
  listRecipients,
  parseDeclaredRecipients,
  resolveRecipient,
  spliceAtMention,
} from "./recipient.ts";

test("deriveNickname strips path and spaces", () => {
  expect(deriveNickname("People/Pete Smith")).toBe("PeteSmith");
  expect(deriveNickname("petra")).toBe("petra");
});

test("registry case-insensitivity and collisions", () => {
  const registry = buildRecipientRegistry([
    { name: "People/Pete Smith", aliases: ["pete"] },
    { name: "Aardvark/Pete" },
  ]);
  expect(registry.byNickname.get("petesmith")!.target).toBe(
    "People/Pete Smith",
  );
  // "pete" is claimed by an explicit nickname and Aardvark/Pete's derived
  // one: the explicit claim wins, and the nickname is ambiguous
  expect(registry.byNickname.get("pete")!.target).toBe("People/Pete Smith");
  expect(registry.ambiguous.has("pete")).toBe(true);
  expect(registry.ambiguous.has("petesmith")).toBe(false);
});

test("derived-vs-derived nickname collisions are properly tracked", () => {
  const registry = buildRecipientRegistry([
    { name: "Zebra/Pete Smith" },
    { name: "Aardvark/Pete Smith" },
  ]);
  // Alphabetically first target wins even among derived nicknames
  expect(registry.byNickname.get("petesmith")!.target).toBe(
    "Aardvark/Pete Smith",
  );
  // Ambiguous because multiple derived candidates have different targets
  expect(registry.ambiguous.has("petesmith")).toBe(true);
});

test("explicit claim beats derived, marked ambiguous when targets differ", () => {
  const registry = buildRecipientRegistry([
    { name: "People/Pete", aliases: ["pete"] },
    { name: "Elsewhere/Pete" },
  ]);
  // Explicit "pete" from first page wins
  expect(registry.byNickname.get("pete")!.target).toBe("People/Pete");
  // Marked ambiguous because derived nickname from second page also claims "pete"
  expect(registry.ambiguous.has("pete")).toBe(true);
});

test("alias derivation strips spaces the same way page names do", () => {
  const registry = buildRecipientRegistry([
    { name: "People/Pete", aliases: ["Pete Smith Jr"] },
  ]);
  expect(registry.byNickname.get("petesmithjr")!.target).toBe("People/Pete");
  expect(registry.byNickname.get("petesmithjr")!.nickname).toBe("PeteSmithJr");
});

test("deriveAliasNickname strips spaces only, unlike deriveNickname it never splits on a path separator", () => {
  expect(deriveAliasNickname("a/b c")).toBe("a/bc");
  expect(deriveAliasNickname("pete")).toBe("pete");
  // Contrast: deriveNickname (page names) would drop everything before "/"
  expect(deriveNickname("a/b c")).toBe("bc");
});

async function indexRecipientPage(name: string, aliases?: string[]) {
  await (globalThis as any).syscall("index.indexObjects", name, [
    {
      ref: name,
      tag: "page",
      name,
      tags: ["recipient"],
      ...(aliases ? { aliases } : {}),
    },
  ]);
}

async function indexMentions(page: string, aliases: string[]): Promise<void> {
  await (globalThis as any).syscall(
    "index.indexObjects",
    page,
    aliases.map((alias, i) => {
      const pos = i * 100;
      return {
        ref: `${page}@${pos}`,
        tag: "relation",
        kind: "at-mention",
        from: page,
        fromTag: "page",
        to: `recipient:${alias.toLowerCase()}`,
        toTag: "recipient",
        alias,
        page,
        range: [pos, pos + alias.length + 1],
        pageLastModified: "",
      };
    }),
  );
}

test("the recipient tag is configurable via recipients.tag", async () => {
  const { config } = createMockSystem();
  config.set("recipients.tag", "person");
  await (globalThis as any).syscall("index.indexObjects", "People/Anna", [
    {
      ref: "People/Anna",
      tag: "page",
      name: "People/Anna",
      tags: ["person"],
    },
  ]);
  await (globalThis as any).syscall("index.indexObjects", "People/Bob", [
    {
      ref: "People/Bob",
      tag: "page",
      name: "People/Bob",
      tags: ["recipient"],
    },
  ]);

  const result = await listRecipients();
  expect(result).toEqual([
    {
      nickname: "Anna",
      nicknames: ["Anna"],
      target: "People/Anna",
      page: "People/Anna",
      ids: ["recipient:anna"],
    },
  ]);
});

test("atMentionComplete offers page-backed and pageless recipients", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "me" }),
  });
  await indexRecipientPage("People/Pete Smith", ["pete"]);
  await indexMentions("Notes", ["Sales"]);

  const result = await atMentionComplete({
    pageName: "test",
    linePrefix: "Hello @Pe",
    pos: 9,
    parentNodes: [],
  });
  expect(result).not.toBeNull();
  expect(result!.from).toBe(7); // right after the @
  const labels = result!.options.map((o) => o.label);
  // Every spelling completes, not just the one labelling the recipient
  expect(labels).toContain("PeteSmith");
  expect(labels).toContain("pete");
  expect(labels).toContain("Sales");
  // No completion glued to a word (emails)
  expect(
    await atMentionComplete({
      pageName: "test",
      linePrefix: "pete@ex",
      pos: 7,
      parentNodes: [],
    }),
  ).toBeNull();
});

test("listRecipients lists one entry per page, holding all of its spellings", async () => {
  createMockSystem();
  await indexRecipientPage("People/Pete Smith", ["pete"]);
  await indexRecipientPage("Aardvark/Pete");

  const result = await listRecipients();

  // Both spellings belong to one person, so they are one entry keyed by the
  // page -- filtering on it must not split @pete from @PeteSmith. Its label
  // is the page's own derived nickname.
  expect(result).toEqual([
    {
      nickname: "PeteSmith",
      nicknames: ["pete", "PeteSmith"],
      target: "People/Pete Smith",
      page: "People/Pete Smith",
      ids: ["recipient:pete", "recipient:petesmith"],
    },
  ]);
  // "pete" is claimed by both People/Pete Smith (explicit alias) and
  // Aardvark/Pete (derived) -- only the winning page is listed, not both.
  expect(result.some((r) => r.page === "Aardvark/Pete")).toBe(false);
});

test("listRecipients labels a page by an alias when the page name yields none", async () => {
  createMockSystem();
  await indexRecipientPage("People/Pete Smith", ["pete"]);
  await indexRecipientPage("Aardvark/PeteSmith");

  // Aardvark/PeteSmith takes the derived "petesmith" nickname, leaving
  // People/Pete Smith with only its explicit alias to be labelled by.
  const result = await listRecipients();
  expect(result.find((r) => r.page === "People/Pete Smith")).toEqual({
    nickname: "pete",
    nicknames: ["pete"],
    target: "People/Pete Smith",
    page: "People/Pete Smith",
    ids: ["recipient:pete"],
  });
});

test("listRecipients joins mentioned nicknames with the pages claiming them", async () => {
  createMockSystem();
  await indexRecipientPage("People/Pete Smith");
  // Two spellings of the same pageless recipient: the most common one labels it
  await indexMentions("Notes", ["Sales", "Sales"]);
  await indexMentions("Other", ["sales"]);
  // Mentions of a page-backed nickname record the same identifier, and join
  // onto the claiming page -- one entry, whatever order things were indexed in
  await indexMentions("Stale", ["petesmith"]);

  const result = await listRecipients();
  expect(result).toEqual([
    {
      nickname: "PeteSmith",
      nicknames: ["PeteSmith"],
      target: "People/Pete Smith",
      page: "People/Pete Smith",
      ids: ["recipient:petesmith"],
    },
    {
      nickname: "Sales",
      nicknames: ["Sales"],
      target: "recipient:sales",
      ids: ["recipient:sales"],
    },
  ]);
});

test("listRecipients lists a mentioned nickname with no page at all", async () => {
  createMockSystem();
  await indexMentions("Notes", ["Sales"]);

  expect(await listRecipients()).toEqual([
    {
      nickname: "Sales",
      nicknames: ["Sales"],
      target: "recipient:sales",
      ids: ["recipient:sales"],
    },
  ]);
});

test("resolveRecipient always returns the recipient: identifier, page when claimed", async () => {
  createMockSystem();
  await indexRecipientPage("People/Pete Smith");

  expect(await resolveRecipient("petesmith")).toEqual({
    ok: true,
    target: "recipient:petesmith",
    page: "People/Pete Smith",
  });
  expect(await resolveRecipient("Sales")).toEqual({
    ok: true,
    target: "recipient:sales",
  });
});

test("spliceAtMention remove mode eats the mention and one adjacent space", () => {
  const remove = (text: string, start: number, nickname = "petra") =>
    spliceAtMention({
      text,
      range: [start, start + nickname.length + 1],
      nickname,
      target: "People/Petra",
      mode: "remove",
    });
  // Leading space preferred, so no double space is left behind
  expect(remove("Talked to @petra today", 10)).toBe("Talked to today");
  // Start-of-line mention eats the trailing space instead
  expect(remove("@petra called me", 0)).toBe("called me");
  // Start-of-line via newline boundary too
  expect(remove("Hi\n@petra called", 3)).toBe("Hi\ncalled");
  // No adjacent space at all: just the mention goes
  expect(remove("(@petra)", 1)).toBe("()");
  // Mention at the very end
  expect(remove("Talked to @petra", 10)).toBe("Talked to");
  // CRLF text: the \r is not an eatable space
  expect(remove("A\r\nTalked to @petra now\r\n", 13)).toBe(
    "A\r\nTalked to now\r\n",
  );
  // Stale range: text returned unchanged
  expect(remove("Talked to @petr today", 10)).toBe("Talked to @petr today");
});

test("spliceAtMention delete-host mode deletes a task/item line", () => {
  const del = (text: string, start: number) =>
    spliceAtMention({
      text,
      range: [start, start + "@petra".length],
      nickname: "petra",
      target: "People/Petra",
      mode: "delete-host",
    });
  // A task line goes whole, including its trailing newline
  expect(del("Intro.\n\n* [ ] Review @petra\nAfter.\n", 21)).toBe(
    "Intro.\n\nAfter.\n",
  );
  // An indented item line: only that one line, children stay
  const nested = "* parent\n  - child @petra\n  - sibling\n";
  expect(del(nested, 19)).toBe("* parent\n  - sibling\n");
  // A list line at the very end of the text, no trailing newline
  expect(del("Intro.\n- ping @petra", 14)).toBe("Intro.\n");
  // A solo list line between blanks takes one of them, no double blank left
  expect(del("A\n\n* ping @petra\n\nB\n", 10)).toBe("A\n\nB\n");
  // Ordered-list lines are list lines too: only the one line goes
  expect(del("1. one @petra\n2. two\n\nB\n", 7)).toBe("2. two\n\nB\n");
  expect(del("Intro.\n\n1) ping @petra\nAfter.\n", 16)).toBe(
    "Intro.\n\nAfter.\n",
  );
});

test("spliceAtMention delete-host mode deletes the enclosing paragraph", () => {
  const del = (text: string, start: number) =>
    spliceAtMention({
      text,
      range: [start, start + "@petra".length],
      nickname: "petra",
      target: "People/Petra",
      mode: "delete-host",
    });
  // Multi-line paragraph in the middle: the blank after it goes too,
  // so no double blank remains
  expect(del("A\n\nTalked to @petra today\nmore of it\n\nB\n", 13)).toBe(
    "A\n\nB\n",
  );
  // Paragraph at the start: the following blank line goes with it
  expect(del("Talked to @petra\n\nB\n", 10)).toBe("B\n");
  // Paragraph at the end: no blank after, so the one before goes
  expect(del("A\n\nTalked to @petra\n", 13)).toBe("A\n");
  // The whole text is one paragraph
  expect(del("Talked to @petra", 10)).toBe("");
  // Paragraph at EOF without a trailing newline
  expect(del("A\n\nTalked to @petra", 13)).toBe("A\n");
  // CRLF text: \r-bearing blank lines still read as blank
  expect(del("A\r\n\r\nTalked to @petra\r\n\r\nB\r\n", 15)).toBe(
    "A\r\n\r\nB\r\n",
  );
});

test("spliceAtMention delete-host stops at structural boundaries", () => {
  const del = (text: string, start: number) =>
    spliceAtMention({
      text,
      range: [start, start + "@petra".length],
      nickname: "petra",
      target: "People/Petra",
      mode: "delete-host",
    });
  // A frontmatter fence is a paragraph boundary, never paragraph text
  expect(del("---\ntags: x\n---\nTalked to @petra\n\nB\n", 26)).toBe(
    "---\ntags: x\n---\nB\n",
  );
  // A heading is never part of the paragraph below it
  expect(del("# Head\nTalked to @petra\n\nB\n", 17)).toBe("# Head\nB\n");
});

test("spliceAtMention verifies before splicing", () => {
  const text = "Hello @PeteSmith!";
  expect(
    spliceAtMention({
      text,
      range: [6, 16],
      nickname: "PeteSmith",
      target: "People/Pete Smith",
    }),
  ).toBe("Hello [[People/Pete Smith|PeteSmith]]!");
  // Stale range: text returned unchanged
  expect(
    spliceAtMention({
      text: "Xxllo @PeteSmith!",
      range: [0, 10],
      nickname: "PeteSmith",
      target: "People/Pete Smith",
    }),
  ).toBe("Xxllo @PeteSmith!");
});

test("a frontmatter-declared nickname is a known recipient", async () => {
  createMockSystem();
  await (globalThis as any).syscall("index.indexObjects", "Notes", [
    {
      ref: "Notes@recipients/sales",
      tag: "relation",
      kind: "recipients",
      from: "Notes",
      fromTag: "page",
      to: "recipient:sales",
      toTag: "recipient",
      alias: "sales",
      page: "Notes",
      pageLastModified: "",
    },
  ]);
  const listing = await listRecipients();
  expect(listing.map((r) => r.nickname)).toEqual(["sales"]);
  expect(listing[0].target).toBe("recipient:sales");
});

test("parseDeclaredRecipients accepts a list, a plain string, and @ notation", () => {
  expect(parseDeclaredRecipients(["ada", "Pete Smith"])).toEqual([
    "ada",
    "Pete Smith",
  ]);
  // A plain string is cut on whitespace: one recipient each, like tags
  expect(parseDeclaredRecipients("ada sales")).toEqual(["ada", "sales"]);
  expect(parseDeclaredRecipients("@ada @sales")).toEqual(["ada", "sales"]);
  expect(parseDeclaredRecipients(["@ada"])).toEqual(["ada"]);
  // A wikilink survives the cut whole, spaces and all
  expect(parseDeclaredRecipients("[[Team/Ops Squad]] ada")).toEqual([
    "[[Team/Ops Squad]]",
    "ada",
  ]);
  expect(parseDeclaredRecipients("  ")).toEqual([]);
  expect(parseDeclaredRecipients(undefined)).toEqual([]);
});

function frontmatterCompleteEvent(linePrefix: string, fmContent: string) {
  return {
    linePrefix,
    pos: linePrefix.length,
    pageName: "TestPage",
    parentNodes: [`FrontMatter:${fmContent}`],
  } as any;
}

test("frontmatterRecipientComplete offers nicknames inside a recipients value", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "me" }),
  });
  await indexRecipientPage("People/Pete Smith", ["pete"]);

  const inline = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: ", "recipients: "),
  );
  // Nothing typed yet, so the current user ("me" -- no accounts here) is
  // offered alongside the known nicknames.
  expect(inline!.options.map((o: any) => o.label).sort()).toEqual([
    "PeteSmith",
    "me",
    "pete",
  ]);
  expect(inline!.from).toBe("recipients: ".length);

  // A typed @ is part of the prefix, so completing replaces it: unquoted, an
  // @ is a YAML syntax error. Matching it against the bare nicknames is ours
  // to do, since the @ would fail CodeMirror's own filter.
  const afterAt = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: @pe", "recipients: @pe"),
  );
  expect(afterAt!.from).toBe("recipients: ".length);
  expect(afterAt!.filter).toBe(false);
  expect(afterAt!.options.map((o: any) => o.label).sort()).toEqual([
    "PeteSmith",
    "pete",
  ]);
  // ...and a prefix matching nothing offers nothing
  const noMatch = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: @zzz", "recipients: @zzz"),
  );
  expect(noMatch!.options).toEqual([]);

  // The list form, one `- item` per line under the key
  const listForm = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("- pe", "recipients:\n- pe"),
  );
  expect(listForm!.from).toBe("- ".length);

  // A list under some other key is not a recipients list
  expect(
    await frontmatterRecipientComplete(
      frontmatterCompleteEvent("- pe", "aliases:\n- pe"),
    ),
  ).toBeNull();

  // Outside frontmatter entirely
  expect(
    await frontmatterRecipientComplete({
      linePrefix: "recipients: ",
      pos: 12,
      pageName: "TestPage",
      parentNodes: [],
    } as any),
  ).toBeNull();
});

test("atMentionComplete stays out of frontmatter", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "me" }),
  });
  await indexRecipientPage("People/Pete Smith", ["pete"]);
  const inBody = await atMentionComplete(
    makeCompleteEvent("Talked to @pe") as any,
  );
  expect(inBody!.options.length).toBeGreaterThan(0);
  // Same line prefix, but inside frontmatter: recipients: owns the @ there
  expect(
    await atMentionComplete(
      frontmatterCompleteEvent("recipients: @pe", "recipients: @pe"),
    ),
  ).toBeNull();
});

function makeCompleteEvent(linePrefix: string) {
  return {
    linePrefix,
    pos: linePrefix.length,
    pageName: "TestPage",
    parentNodes: [],
  };
}

test("at-mention completion always offers the current user", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "ada" }),
  });
  const result = await atMentionComplete(makeCompleteEvent("@") as any);
  expect(result!.options.map((o: any) => o.label)).toContain("ada");
});

test("the current user's own username is offered under their real name", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "ada", fullName: "Ada Lovelace" }),
  });
  const result = await atMentionComplete(makeCompleteEvent("@") as any);
  const own = result!.options.find((o: any) => o.label === "ada");
  expect(own).toBeDefined();
  expect(own!.detail).toBe("you");
});

test("an existing recipient entry for you is not duplicated", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "ada", fullName: "Ada Lovelace" }),
  });
  await indexRecipientPage("People/Ada", ["ada"]);
  const result = await atMentionComplete(makeCompleteEvent("@") as any);
  expect(result!.options.filter((o: any) => o.label === "ada")).toHaveLength(1);
});

test("an existing recipient entry for you is not duplicated in frontmatter", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "ada", fullName: "Ada Lovelace" }),
  });
  await indexRecipientPage("People/Ada", ["ada"]);
  const result = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: ad", "recipients: ad"),
  );
  expect(result!.options.filter((o: any) => o.label === "ada")).toHaveLength(1);
});

test("frontmatter recipient completion offers the current user too", async () => {
  const { system } = createMockSystem();
  system.registerSyscalls([], {
    "system.getProfile": () => ({ username: "ada" }),
  });
  const result = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: ", "recipients: "),
  );
  expect(result!.options.map((o: any) => o.label)).toContain("ada");
});
