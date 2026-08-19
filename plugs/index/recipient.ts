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

/** At-mention relations whose nickname had no registry entry when the
 * mentioning page was indexed: the implicit recipients. */
async function queryImplicitMentions(): Promise<
  { to: string; alias?: string }[]
> {
  return await index.queryLuaObjects<{ to: string; alias?: string }>(
    "relation",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `_.kind == "at-mention" and _.toTag == "recipient"`,
      ),
    },
  );
}

export async function listRecipients(): Promise<
  { nickname: string; target: string }[]
> {
  const registry = await fetchRecipientRegistry();
  const taken = new Set<string>();
  const seen = new Set<string>();
  const result: { nickname: string; target: string }[] = [];
  for (const entry of registry.byNickname.values()) {
    taken.add(entry.nickname.toLowerCase());
    const key = `${entry.nickname}\0${entry.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ nickname: entry.nickname, target: entry.target });
  }
  // Aliases per implicit target, so the label can be the most common
  // spelling actually typed rather than the lowercased identifier.
  const aliasCounts = new Map<string, Map<string, number>>();
  for (const m of await queryImplicitMentions()) {
    if (!m.alias) continue;
    let counts = aliasCounts.get(m.to);
    if (!counts) {
      counts = new Map();
      aliasCounts.set(m.to, counts);
    }
    counts.set(m.alias, (counts.get(m.alias) ?? 0) + 1);
  }
  for (const [target, counts] of aliasCounts) {
    const nickname = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0];
    // Page-backed entries win a nickname; an implicit one that still shares
    // it is a stale mention awaiting reindex.
    if (taken.has(nickname.toLowerCase())) continue;
    result.push({ nickname, target });
  }
  result.sort((a, b) => a.nickname.localeCompare(b.nickname));
  return result;
}

export async function atMentionComplete(completeEvent: CompleteEvent) {
  const match = /(?:^|[\s([{])@([^\s@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const registry = await fetchRecipientRegistry();
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const entry of registry.byNickname.values()) {
    if (seen.has(entry.nickname.toLowerCase())) {
      continue;
    }
    seen.add(entry.nickname.toLowerCase());
    options.push({
      label: entry.nickname,
      type: "at-mention",
      detail: entry.target,
    });
  }
  for (const m of await queryImplicitMentions()) {
    if (!m.alias || seen.has(m.alias.toLowerCase())) {
      continue;
    }
    seen.add(m.alias.toLowerCase());
    options.push({
      label: m.alias,
      type: "at-mention",
      detail: m.to,
    });
  }
  return {
    from: completeEvent.pos - match[1].length,
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
): Promise<{ ok: true; target: string; hasPage: boolean }> {
  const registry = await fetchRecipientRegistry();
  const entry = registry.byNickname.get(nickname.toLowerCase());
  if (entry) {
    return { ok: true, target: entry.target, hasPage: true };
  }
  return {
    ok: true,
    target: RECIPIENT_PREFIX + nickname.toLowerCase(),
    hasPage: false,
  };
}

export async function resolveAtMention(
  pageName: string,
  range: [number, number],
  nickname: string,
  target: string,
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
