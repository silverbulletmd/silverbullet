import type { Completion } from "@codemirror/autocomplete";
import {
  config,
  editor,
  index,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import { frontmatterValuePrefix } from "./complete.ts";

/** Namespace for a recipient identifier. Kept short: it is stored on every
 * mention relation and on every `recipient` object in the index. */
export const RECIPIENT_PREFIX = "re:";

/** A recipient is a name; this is the identifier every mention of it carries. */
export function recipientId(name: string): string {
  return RECIPIENT_PREFIX + name.toLowerCase();
}

// One entry of a `recipients:` frontmatter value: a wikilink (kept whole, so
// the indexer can recognise one and leave it alone rather than minting junk
// names out of its halves) or a run of non-space characters.
const declaredRecipientRegex = /\[\[[^\]]*\]\]|\S+/g;

/** The entries of a `recipients:` frontmatter value. A list gives one entry
 * per item; a plain string is cut on whitespace, so `recipients: ada sales`
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

export type RecipientListing = {
  name: string;
  id: string;
  detail?: string;
};

/** Every name this space has been seen addressing, with the spelling most of
 * its pages use. Read from the `recipient` objects the indexer emits per page,
 * so this is a scan of one small tag rather than of every relation. */
async function mentionedNames(): Promise<Map<string, string>> {
  const objects = await index.queryLuaObjects<{ ref: string; name: string }>(
    "recipient",
    { objectVariable: "_" },
  );
  const spellings = new Map<string, Map<string, number>>();
  for (const object of objects) {
    if (!object?.ref || typeof object.name !== "string") continue;
    let counts = spellings.get(object.ref);
    if (!counts) {
      counts = new Map();
      spellings.set(object.ref, counts);
    }
    counts.set(object.name, (counts.get(object.name) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const [ref, counts] of spellings) {
    result.set(
      ref,
      [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0][0],
    );
  }
  return result;
}

/** Every name this space can address: its accounts, whatever `recipient.define`
 * registered, and every name already mentioned. */
export async function listRecipients(): Promise<RecipientListing[]> {
  const byId = new Map<string, RecipientListing>();
  const add = (name: string, detail?: string) => {
    const id = recipientId(name);
    if (byId.has(id)) return;
    byId.set(id, detail ? { name, id, detail } : { name, id });
  };

  for (const account of await system.listAccounts()) {
    // A deployment without accounts has a current user but no name for them,
    // and a nameless recipient is not addressable.
    if (!account.username) continue;
    add(account.username, account.me ? "you" : account.fullName);
  }
  const defined = await config.get<
    Record<string, { name?: string; description?: string }>
  >("recipients", {});
  for (const [key, spec] of Object.entries(defined ?? {})) {
    add(
      typeof spec?.name === "string" && spec.name ? spec.name : key,
      spec?.description,
    );
  }
  for (const [id, name] of await mentionedNames()) {
    if (!byId.has(id)) byId.set(id, { name, id });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  return {
    // The option set does not depend on what has been typed — every recipient
    // is offered and CodeMirror filters. Saying so keeps it from re-running
    // this source, and the relation scan behind it, on every keystroke.
    validFor: /^[^\s@]*$/,
    from: completeEvent.pos - match[1].length,
    options: (await listRecipients()).map(
      (recipient): Completion => ({
        label: recipient.name,
        type: "at-mention",
        detail: recipient.detail,
      }),
    ),
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
  // measure `@ad` against a bare `ada` and reject it: the matching is ours.
  const typed = prefix.replace(/^@/, "").toLowerCase();
  return {
    from: completeEvent.pos - prefix.length,
    filter: false,
    options: (await listRecipients())
      .filter((recipient) => recipient.name.toLowerCase().includes(typed))
      .map(
        (recipient): Completion => ({
          label: recipient.name,
          type: "at-mention",
          detail: recipient.detail,
        }),
      ),
  };
}

export type MentionMode = "remove" | "delete-host";

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
  mode: MentionMode;
}): { from: number; to: number; insert: string } | null {
  const { text, range, nickname, mode } = args;
  const [start, end] = range;
  if (text.slice(start, end) !== `@${nickname}`) {
    return null;
  }
  switch (mode) {
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
  mode: MentionMode;
}): string {
  const edit = computeMentionEdit(args);
  if (!edit) {
    return args.text;
  }
  return args.text.slice(0, edit.from) + edit.insert + args.text.slice(edit.to);
}

export async function resolveAtMention(
  pageName: string,
  range: [number, number],
  nickname: string,
  mode: MentionMode,
): Promise<boolean> {
  const doneMessage =
    mode === "remove" ? `Removed @${nickname}` : `Deleted @${nickname} mention`;
  const staleMessage =
    "Page changed since indexing — reopen the mention and try again";
  if ((await editor.getCurrentPage()) === pageName) {
    const text = await editor.getText();
    const edit = computeMentionEdit({ text, range, nickname, mode });
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
  const newText = spliceAtMention({ text, range, nickname, mode });
  if (newText === text) {
    await editor.flashNotification(staleMessage, "error");
    return false;
  }
  await space.writePage(pageName, newText);
  await editor.flashNotification(doneMessage);
  return true;
}
