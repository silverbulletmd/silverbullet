import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import {
  atMentionComplete,
  frontmatterRecipientComplete,
  listRecipients,
  parseDeclaredRecipients,
  recipientId,
  spliceAtMention,
} from "./recipient.ts";

/** A mock system whose deployment reports `accounts` and whose current user is
 * `profile`. Both syscalls are overridden: the real ones need a live client. */
function mockSpace(accounts: any[], profile: any = { username: "me" }) {
  const mock = createMockSystem();
  mock.system.registerSyscalls([], {
    "system.listAccounts": () => accounts,
    "system.getProfile": () => profile,
  });
  return mock;
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

test("recipientId lowercases, so @Bob and @bob are one recipient", () => {
  expect(recipientId("Bob")).toBe("recipient:bob");
  expect(recipientId("bob")).toBe("recipient:bob");
});

test("accounts are recipients, labelled by full name", async () => {
  mockSpace([
    { username: "ada", fullName: "Ada Lovelace", me: false },
    { username: "bob", me: false },
  ]);
  const listed = await listRecipients();
  expect(listed).toEqual([
    { name: "ada", id: "recipient:ada", detail: "Ada Lovelace" },
    { name: "bob", id: "recipient:bob" },
  ]);
});

test("your own account is labelled you, under your real username", async () => {
  mockSpace([
    { username: "ada", fullName: "Ada Lovelace", me: true },
    { username: "bob", me: false },
  ]);
  expect(await listRecipients()).toEqual([
    { name: "ada", id: "recipient:ada", detail: "you" },
    { name: "bob", id: "recipient:bob" },
  ]);
});

test("a deployment with no accounts has no recipient for the current user", async () => {
  mockSpace([{ username: null, fullName: "Zef Hemel", me: true }]);
  await indexMentions("Notes", ["Sales"]);
  expect(await listRecipients()).toEqual([
    { name: "Sales", id: "recipient:sales" },
  ]);
});

test("defined recipients carry their description", async () => {
  const { config } = mockSpace([]);
  config.set(["recipients", "sales"], {
    name: "sales",
    description: "Sales team",
  });
  const listed = await listRecipients();
  expect(listed.find((r) => r.name === "sales")).toEqual({
    name: "sales",
    id: "recipient:sales",
    detail: "Sales team",
  });
});

test("an account wins the spelling over a definition of the same name", async () => {
  const { config } = mockSpace([
    { username: "ada", fullName: "Ada Lovelace", me: false },
  ]);
  config.set(["recipients", "Ada"], { name: "Ada", description: "not this" });
  const listed = await listRecipients();
  expect(listed.filter((r) => r.id === "recipient:ada")).toEqual([
    { name: "ada", id: "recipient:ada", detail: "Ada Lovelace" },
  ]);
});

test("an unclaimed mentioned name is a recipient, spelled the way it is written most", async () => {
  mockSpace([]);
  await indexMentions("Notes", ["Sales", "Sales", "sales"]);
  const listed = await listRecipients();
  expect(listed.find((r) => r.id === "recipient:sales")).toEqual({
    name: "Sales",
    id: "recipient:sales",
  });
});

test("a frontmatter-declared name is a known recipient", async () => {
  mockSpace([]);
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
  const listed = await listRecipients();
  expect(listed.map((r) => r.name)).toEqual(["sales"]);
});

test("spliceAtMention remove mode eats the mention and one adjacent space", () => {
  const remove = (text: string, start: number, nickname = "petra") =>
    spliceAtMention({
      text,
      range: [start, start + nickname.length + 1],
      nickname,
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
  // Stale range: the text no longer reads `@nickname` there, so nothing moves
  expect(
    spliceAtMention({
      text: "Xxllo @PeteSmith!",
      range: [0, 10],
      nickname: "PeteSmith",
      mode: "remove",
    }),
  ).toBe("Xxllo @PeteSmith!");
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
  // A wikilink survives the cut whole, spaces and all, so the indexer can
  // recognise one and leave it alone rather than minting junk names from it
  expect(parseDeclaredRecipients("[[Team/Ops Squad]] ada")).toEqual([
    "[[Team/Ops Squad]]",
    "ada",
  ]);
  expect(parseDeclaredRecipients("  ")).toEqual([]);
  expect(parseDeclaredRecipients(undefined)).toEqual([]);
});

function makeCompleteEvent(linePrefix: string) {
  return {
    linePrefix,
    pos: linePrefix.length,
    pageName: "TestPage",
    parentNodes: [],
  } as any;
}

function frontmatterCompleteEvent(linePrefix: string, fmContent: string) {
  return {
    linePrefix,
    pos: linePrefix.length,
    pageName: "TestPage",
    parentNodes: [`FrontMatter:${fmContent}`],
  } as any;
}

test("atMentionComplete offers every known recipient with its detail", async () => {
  mockSpace([{ username: "ada", fullName: "Ada Lovelace", me: true }]);
  await indexMentions("Notes", ["Sales"]);
  const result = await atMentionComplete(makeCompleteEvent("Ping @"));
  expect(result!.options).toEqual([
    { label: "ada", type: "at-mention", detail: "you" },
    { label: "Sales", type: "at-mention", detail: undefined },
  ]);
  expect(result!.from).toBe("Ping @".length);
});

test("atMentionComplete stays out of frontmatter", async () => {
  mockSpace([]);
  const result = await atMentionComplete({
    linePrefix: "recipients: @",
    pos: 13,
    pageName: "TestPage",
    parentNodes: ["FrontMatter:recipients: @"],
  } as any);
  expect(result).toBeNull();
});

test("at-mention completion offers your own account, labelled you", async () => {
  mockSpace([{ username: "ada", me: true }]);
  const result = await atMentionComplete(makeCompleteEvent("@"));
  const own = result!.options.find((o: any) => o.label === "ada");
  expect(own).toBeDefined();
  expect(own!.detail).toBe("you");
});

test("frontmatterRecipientComplete filters on what has been typed", async () => {
  mockSpace([
    { username: "ada", fullName: "Ada Lovelace", me: false },
    { username: "bob", me: false },
  ]);
  const result = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: ad", "recipients: ad"),
  );
  expect(result!.options.map((o: any) => o.label)).toEqual(["ada"]);
  expect(result!.filter).toBe(false);
});

test("frontmatter recipient completion offers the current user too", async () => {
  mockSpace([{ username: "ada", me: true }]);
  const result = await frontmatterRecipientComplete(
    frontmatterCompleteEvent("recipients: ", "recipients: "),
  );
  expect(result!.options.map((o: any) => o.label)).toContain("ada");
});
