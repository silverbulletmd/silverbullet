import type { Completion } from "@codemirror/autocomplete";
import {
  config,
  editor,
  index,
  lua,
  space,
} from "@silverbulletmd/silverbullet/syscalls";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { frontmatterValuePrefix } from "./complete.ts";

export const RECIPIENT_PREFIX = "recipient:";

export type RecipientEntry = {
  nickname: string;
  target: string;
};

export type RecipientRegistry = {
  byNickname: Map<string, RecipientEntry>;
  ambiguous: Set<string>;
};

export function deriveNickname(pageName: string): string {
  return pageName.split("/").pop()!.replaceAll(" ", "");
}

/** Alias-to-nickname derivation: spaces only, no path-splitting — an alias
 * isn't a page path the way a page name is. */
export function deriveAliasNickname(alias: string): string {
  return alias.replaceAll(" ", "");
}

// One entry of a `recipients:` frontmatter value: a wikilink (kept whole, so
// a page name with spaces survives) or a run of non-space characters.
const declaredRecipientRegex = /\[\[[^\]]*\]\]|\S+/g;

/** The entries of a `recipients:` frontmatter value. A list gives one entry
 * per item; a plain string is cut on whitespace, so `recipients: zef sales`
 * names two. A leading `@` is optional either way, the way a leading `#` is
 * on a tag. */
export function parseDeclaredRecipients(value: unknown): string[] {
  const entries =
    typeof value === "string"
      ? (value.match(declaredRecipientRegex) ?? [])
      : Array.isArray(value)
        ? value.map((entry) => String(entry))
        : [];
  return entries
    .map((entry) => entry.trim().replace(/^@/, ""))
    .filter((entry) => entry !== "");
}

export function buildRecipientRegistry(
  pages: { name: string; aliases?: string[] }[],
): RecipientRegistry {
  const explicitCandidates = new Map<string, RecipientEntry[]>();
  const derivedCandidates = new Map<string, RecipientEntry[]>();
  const add = (
    nickname: string,
    target: string,
    tier: Map<string, RecipientEntry[]>,
  ) => {
    const key = nickname.toLowerCase();
    const list = tier.get(key) ?? [];
    list.push({ nickname, target });
    tier.set(key, list);
  };
  for (const page of pages) {
    for (const alias of page.aliases ?? []) {
      add(deriveAliasNickname(alias), page.name, explicitCandidates);
    }
  }
  for (const page of pages) {
    add(deriveNickname(page.name), page.name, derivedCandidates);
  }
  const byNickname = new Map<string, RecipientEntry>();
  const ambiguous = new Set<string>();
  const allKeys = new Set<string>();
  explicitCandidates.forEach((_, key) => allKeys.add(key));
  derivedCandidates.forEach((_, key) => allKeys.add(key));
  for (const key of allKeys) {
    const explicit = explicitCandidates.get(key) ?? [];
    const derived = derivedCandidates.get(key) ?? [];
    let winner: RecipientEntry;
    if (explicit.length > 0) {
      explicit.sort((a, b) => a.target.localeCompare(b.target));
      winner = explicit[0];
    } else {
      derived.sort((a, b) => a.target.localeCompare(b.target));
      winner = derived[0];
    }
    byNickname.set(key, winner);
    const allTargets = new Set([...explicit, ...derived].map((e) => e.target));
    if (allTargets.size > 1) {
      ambiguous.add(key);
    }
  }
  return { byNickname, ambiguous };
}

export async function fetchRecipientRegistry(): Promise<RecipientRegistry> {
  const recipientTag = await config.get<string>("recipients.tag", "recipient");
  const pages = await index.queryLuaObjects<PageMeta & { aliases?: string[] }>(
    "page",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `table.find(_.tags, function(tag) return tag == recipientTag end)`,
      ),
    },
    { recipientTag },
  );
  return buildRecipientRegistry(pages);
}

/** Every reference to a recipient by nickname: inline `@mentions` and the
 * nickname form of `recipients:` frontmatter alike. */
async function queryMentions(): Promise<{ to: string; alias?: string }[]> {
  return await index.queryLuaObjects<{ to: string; alias?: string }>(
    "relation",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `(_.kind == "at-mention" or _.kind == "recipients") and _.toTag == "recipient"`,
      ),
    },
  );
}

export type RecipientListing = {
  nickname: string;
  nicknames: string[];
  target: string;
  page?: string;
  ids: string[];
};

/** Every recipient the space knows about: one entry per `#recipient` page,
 * plus one per mentioned nickname no page claims. `target` is the grouping
 * key consumers filter on — the page for a page-backed recipient, so all of
 * its spellings group together, and the `recipient:` identifier otherwise.
 * `nicknames` are the spellings as written (`nickname` being the one to
 * label the recipient with); `ids` are those same spellings in the
 * identifier form mentions carry, which is how a mention is joined back onto
 * its recipient at read time. */
export async function listRecipients(): Promise<RecipientListing[]> {
  const registry = await fetchRecipientRegistry();
  const byPage = new Map<string, { nicknames: string[]; ids: string[] }>();
  for (const [key, entry] of registry.byNickname) {
    let group = byPage.get(entry.target);
    if (!group) {
      group = { nicknames: [], ids: [] };
      byPage.set(entry.target, group);
    }
    group.nicknames.push(entry.nickname);
    group.ids.push(RECIPIENT_PREFIX + key);
  }
  const result: RecipientListing[] = [];
  for (const [page, group] of byPage) {
    const derived = deriveNickname(page).toLowerCase();
    const nicknames = [...group.nicknames].sort((a, b) => a.localeCompare(b));
    result.push({
      nickname:
        nicknames.find((n) => n.toLowerCase() === derived) ?? nicknames[0],
      nicknames,
      target: page,
      page,
      ids: [...group.ids].sort(),
    });
  }
  // Aliases per mentioned identifier, so a pageless nickname is labelled
  // with the most common spelling actually typed rather than lowercased.
  const aliasCounts = new Map<string, Map<string, number>>();
  for (const m of await queryMentions()) {
    const key = m.to.slice(RECIPIENT_PREFIX.length);
    if (registry.byNickname.has(key)) continue;
    let counts = aliasCounts.get(key);
    if (!counts) {
      counts = new Map();
      aliasCounts.set(key, counts);
    }
    const alias = m.alias ?? key;
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  for (const [key, counts] of aliasCounts) {
    const nickname = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0];
    const target = RECIPIENT_PREFIX + key;
    result.push({ nickname, nicknames: [nickname], target, ids: [target] });
  }
  return result.sort((a, b) => a.nickname.localeCompare(b.nickname));
}

export async function atMentionComplete(completeEvent: CompleteEvent) {
  // Frontmatter is YAML, where an unquoted `@` is a syntax error rather than
  // a mention: `recipients:` has its own completion there.
  if (completeEvent.parentNodes.some((n) => n.startsWith("FrontMatter:"))) {
    return null;
  }
  const match = /(?:^|[\s([{])@([^\s@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const options: Completion[] = [];
  for (const entry of await listRecipients()) {
    for (const nickname of entry.nicknames) {
      options.push({
        label: nickname,
        type: "at-mention",
        detail: entry.target,
      });
    }
  }
  return {
    from: completeEvent.pos - match[1].length,
    options,
  };
}

/** Recipient completion inside a `recipients:` frontmatter value, the
 * counterpart of `@mention` completion in the body. A typed `@` is part of
 * the prefix and so is replaced: unquoted, it is a YAML syntax error. */
export async function frontmatterRecipientComplete(
  completeEvent: CompleteEvent,
) {
  const prefix = frontmatterValuePrefix(completeEvent, "recipients", "@");
  if (prefix === null) {
    return null;
  }
  // The `@` is inside the replaced range, so CodeMirror's own filter would
  // measure `@ze` against a bare `zef` and reject it: the matching is ours.
  const typed = prefix.replace(/^@/, "").toLowerCase();
  const options: Completion[] = [];
  for (const entry of await listRecipients()) {
    for (const nickname of entry.nicknames) {
      if (!nickname.toLowerCase().includes(typed)) {
        continue;
      }
      options.push({
        label: nickname,
        type: "at-mention",
        detail: entry.target,
      });
    }
  }
  return {
    from: completeEvent.pos - prefix.length,
    filter: false,
    options,
  };
}

export type MentionMode = "link" | "remove" | "delete-host";

function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

/** A line a paragraph never extends across: a blank line, a frontmatter
 * fence, or a heading. */
function isParagraphBoundary(line: string): boolean {
  return isBlankLine(line) || /^---\s*$/.test(line) || /^#{1,6}\s/.test(line);
}

function isListLine(line: string): boolean {
  return /^\s*([-*+]|\d+[.)])\s/.test(line);
}

/** The deletion range for `"delete-host"`: the mention's whole list line, or
 * its whole paragraph plus one adjacent blank line. */
function hostDeletion(text: string, pos: number): { from: number; to: number } {
  const lines = text.split("\n");
  // The split artifact after a trailing newline is not a line of its own.
  if (text.endsWith("\n")) {
    lines.pop();
  }
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let mentionLine = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (pos < starts[i] + lines[i].length + 1) {
      mentionLine = i;
      break;
    }
  }
  const rangeOf = (first: number, last: number) => ({
    from: starts[first],
    to: last + 1 < lines.length ? starts[last + 1] : text.length,
  });
  if (isListLine(lines[mentionLine])) {
    // A solo list line between blanks: eat one of them, or the two
    // separators would collapse into a double blank.
    if (
      mentionLine > 0 &&
      isBlankLine(lines[mentionLine - 1]) &&
      mentionLine + 1 < lines.length &&
      isBlankLine(lines[mentionLine + 1])
    ) {
      return rangeOf(mentionLine, mentionLine + 1);
    }
    return rangeOf(mentionLine, mentionLine);
  }
  let first = mentionLine;
  while (first > 0 && !isParagraphBoundary(lines[first - 1])) {
    first--;
  }
  let last = mentionLine;
  while (last < lines.length - 1 && !isParagraphBoundary(lines[last + 1])) {
    last++;
  }
  // One adjacent blank line goes with the paragraph, or the separators on
  // either side of it would collapse into a double blank.
  if (last + 1 < lines.length && isBlankLine(lines[last + 1])) {
    last++;
  } else if (first > 0 && isBlankLine(lines[first - 1])) {
    first--;
  }
  return rangeOf(first, last);
}

/** The single edit a mode makes, or null when the text at `range` no longer
 * reads `@nickname` (the index went stale). */
export function computeMentionEdit(args: {
  text: string;
  range: [number, number];
  nickname: string;
  target: string;
  mode?: MentionMode;
}): { from: number; to: number; insert: string } | null {
  const { text, range, nickname, target, mode = "link" } = args;
  const [start, end] = range;
  if (text.slice(start, end) !== `@${nickname}`) {
    return null;
  }
  switch (mode) {
    case "link":
      return { from: start, to: end, insert: `[[${target}|${nickname}]]` };
    case "remove":
      if (text[start - 1] === " ") {
        return { from: start - 1, to: end, insert: "" };
      }
      if (text[end] === " ") {
        return { from: start, to: end + 1, insert: "" };
      }
      return { from: start, to: end, insert: "" };
    case "delete-host":
      return { ...hostDeletion(text, start), insert: "" };
  }
}

export function spliceAtMention(args: {
  text: string;
  range: [number, number];
  nickname: string;
  target: string;
  mode?: MentionMode;
}): string {
  const edit = computeMentionEdit(args);
  if (!edit) {
    return args.text;
  }
  return args.text.slice(0, edit.from) + edit.insert + args.text.slice(edit.to);
}

export async function resolveRecipient(
  nickname: string,
): Promise<{ ok: true; target: string; page?: string }> {
  const registry = await fetchRecipientRegistry();
  const entry = registry.byNickname.get(nickname.toLowerCase());
  const target = RECIPIENT_PREFIX + nickname.toLowerCase();
  return entry
    ? { ok: true, target, page: entry.target }
    : { ok: true, target };
}

export async function resolveAtMention(
  pageName: string,
  range: [number, number],
  nickname: string,
  mode: MentionMode = "link",
): Promise<boolean> {
  const doneMessage =
    mode === "link"
      ? `Resolved @${nickname}`
      : mode === "remove"
        ? `Removed @${nickname}`
        : `Deleted @${nickname} mention`;
  const staleMessage =
    "Page changed since indexing — reopen the mention and try again";
  let target = "";
  if (mode === "link") {
    // The page claiming this nickname is whatever claims it now, not
    // whatever was indexed alongside the mention.
    const resolved = await resolveRecipient(nickname);
    if (!resolved.page) {
      await editor.flashNotification(
        `@${nickname} has no page to link to`,
        "error",
      );
      return false;
    }
    target = resolved.page;
  }
  if ((await editor.getCurrentPage()) === pageName) {
    const text = await editor.getText();
    const edit = computeMentionEdit({ text, range, nickname, target, mode });
    if (!edit) {
      await editor.flashNotification(staleMessage, "error");
      return false;
    }
    await editor.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
    });
    await editor.flashNotification(doneMessage);
    return true;
  }

  const text = await space.readPage(pageName);
  const newText = spliceAtMention({ text, range, nickname, target, mode });
  if (newText === text) {
    await editor.flashNotification(staleMessage, "error");
    return false;
  }
  await space.writePage(pageName, newText);
  await editor.flashNotification(doneMessage);
  return true;
}
