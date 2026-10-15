import {
  collectNodesMatching,
  findNodeMatching,
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import {
  DERIVED,
  inlineYaml,
  movedError,
  ObjectEditError,
  type ObjectHandler,
  type PlanContext,
  type TextEdit,
  trimmedEnd,
  wholeLines,
} from "./object_edit.ts";

export type InlineKind = "task" | "item" | "paragraph";

const LIST_LINE = /^\s*([*+-]|\d+[.)])\s/;

function checkAttributeName(name: string) {
  if (!/^\w+$/.test(name)) {
    throw new ObjectEditError(
      `"${name}" isn't a valid attribute name (letters, digits and _ only)`,
    );
  }
}

export function toTagList(tags: unknown): string[] {
  const list =
    typeof tags === "string"
      ? tags.split(/\s+/).filter(Boolean)
      : Array.isArray(tags)
        ? tags.map(String)
        : tags && typeof tags === "object"
          ? Object.values(tags).map(String)
          : null;
  if (!list) {
    throw new ObjectEditError("tags must be a list or a string");
  }
  for (const t of list) {
    if (!/^[^\s#[\]]+$/.test(t)) {
      throw new ObjectEditError(`"${t}" isn't a valid tag`);
    }
  }
  return list;
}

function hostNode(
  ctx: PlanContext,
  found: ObjectValue<any>,
  kind: InlineKind,
): ParseTree {
  const type = kind === "paragraph" ? "Paragraph" : "ListItem";
  const host = findNodeMatching(
    ctx.tree,
    (n) => n.type === type && n.from === found.range[0],
  );
  if (!host) throw movedError(found.page);
  return host;
}

const renderAttribute = (key: string, value: unknown) =>
  `[${key}: ${inlineYaml(value)}]`;

const taskState = (state: unknown, done: unknown) =>
  state !== undefined ? String(state) : done ? "x" : " ";

const oneLine = (s: unknown) =>
  String(s)
    .replace(/\s*\n\s*/g, " ")
    .trim();

/** The node holding the object's own line, and where its content starts. */
function ownLine(host: ParseTree, kind: InlineKind) {
  if (kind === "paragraph") {
    return { line: host, contentFrom: host.from!, parts: host.children! };
  }
  const task = host.children!.find((c) => c.type === "Task");
  if (task) {
    return {
      line: task,
      task,
      contentFrom: task.children![0].to!,
      parts: task.children!.slice(1),
    };
  }
  const para = host.children!.find((c) => c.type === "Paragraph");
  if (!para) {
    throw new ObjectEditError("this list item has no text to edit");
  }
  return { line: para, contentFrom: para.from!, parts: para.children! };
}

export function planInlineUpdate(
  ctx: PlanContext,
  found: ObjectValue<any>,
  kind: InlineKind,
  patch: Record<string, unknown>,
  remove: string[],
): TextEdit[] {
  const nameKey = kind === "paragraph" ? "text" : "name";
  const { done, state, tags, [nameKey]: newName, ...attrs } = patch;
  for (const key of [...Object.keys(attrs), ...remove]) {
    checkAttributeName(key);
  }
  const { line, task, contentFrom, parts } = ownLine(
    hostNode(ctx, found, kind),
    kind,
  );
  const edits: TextEdit[] = [];

  if (done !== undefined || state !== undefined) {
    if (!task) {
      throw new ObjectEditError("only tasks have a state");
    }
    const marker = task.children![0].children![1];
    edits.push({
      from: marker.from!,
      to: marker.to!,
      insert: taskState(state, done),
    });
  }

  const attrKeys = Object.keys(attrs);
  if (
    newName === undefined &&
    tags === undefined &&
    attrKeys.length === 0 &&
    remove.length === 0
  ) {
    return edits;
  }

  let out = "";
  let anchor = "";
  const written = new Set<string>();
  for (const part of parts) {
    const raw = renderToText(part);
    switch (part.type) {
      case "Attribute": {
        const name = renderToText(findNodeOfType(part, "AttributeName")!);
        if (remove.includes(name)) break;
        if (name in attrs) {
          out += renderAttribute(name, attrs[name]);
          written.add(name);
        } else {
          out += raw;
        }
        break;
      }
      case "Hashtag":
        if (tags === undefined) out += raw;
        break;
      case "NamedAnchor":
        anchor = raw;
        break;
      default:
        // Keep whitespace between kept tokens when the text is replaced
        if (newName === undefined || raw.trim() === "") out += raw;
    }
  }
  const extra: string[] = [];
  if (tags !== undefined) {
    extra.push(...toTagList(tags).map((t) => `#${t}`));
  }
  for (const key of attrKeys) {
    if (!written.has(key)) extra.push(renderAttribute(key, attrs[key]));
  }
  if (anchor) extra.push(anchor);
  const content =
    `${newName !== undefined ? `${oneLine(newName)} ` : ""}${out} ${extra.join(" ")}`
      .replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ")
      .trim();
  edits.push({
    from: contentFrom,
    to: line.to!,
    insert: (task ? " " : "") + content,
  });
  return edits;
}

export function planInlineDelete(
  ctx: PlanContext,
  found: ObjectValue<any>,
  kind: InlineKind,
): TextEdit[] {
  const { text } = ctx;
  const host = hostNode(ctx, found, kind);
  let { from, to } = wholeLines(text, host.from!, host.to!);
  if (kind === "paragraph") {
    if (text[to] === "\n") {
      to++;
    } else if (from >= 2 && text.slice(from - 2, from) === "\n\n") {
      return [{ from: from - 1, to, insert: "" }];
    }
  }
  return [{ from, to, insert: "" }];
}

function renderInlineRecord(
  record: Record<string, unknown>,
  anchor: string | undefined,
): string {
  const { tag, name, state, done, tags, ...attrs } = record;
  const parts: string[] = [];
  if (tag === "task") {
    parts.push(`[${taskState(state, done)}]`);
  }
  if (name !== undefined) parts.push(oneLine(name));
  if (tags !== undefined) {
    parts.push(...toTagList(tags).map((t) => `#${t}`));
  }
  for (const [key, value] of Object.entries(attrs)) {
    checkAttributeName(key);
    parts.push(renderAttribute(key, value));
  }
  if (anchor) parts.push(`$${anchor}`);
  return `* ${parts.join(" ")}`;
}

function headerLevel(h: ParseTree): number {
  return Number(h.type!.slice(-1));
}

function sectionEnd(ctx: PlanContext, under: string): number {
  const headers = collectNodesMatching(ctx.tree, (n) =>
    /^ATXHeading\d$/.test(n.type ?? ""),
  );
  const index = headers.findIndex(
    (h) =>
      renderToText(h)
        .replace(/^#+\s*/, "")
        .trim() === under,
  );
  if (index < 0) {
    throw new ObjectEditError(`no header "${under}"`);
  }
  const level = headerLevel(headers[index]);
  const next = headers.slice(index + 1).find((h) => headerLevel(h) <= level);
  return next ? next.from! : ctx.text.length;
}

export function planInlineAppend(
  ctx: PlanContext,
  record: Record<string, unknown>,
  anchor: string | undefined,
  under: string | undefined,
): TextEdit[] {
  const { text } = ctx;
  const line = renderInlineRecord(record, anchor);
  const end = under === undefined ? text.length : sectionEnd(ctx, under);
  const from = trimmedEnd(text, end);
  const previous = text.slice(text.lastIndexOf("\n", from - 1) + 1, from);
  const separator = from === 0 ? "" : LIST_LINE.test(previous) ? "\n" : "\n\n";
  const tail = end < text.length ? "\n\n" : "\n";
  return [{ from, to: end, insert: separator + line + tail }];
}

export function inlineHandler(kind: InlineKind): ObjectHandler {
  return {
    readOnly: [...DERIVED, kind === "paragraph" ? "name" : "text"],
    update: (ctx, found, patch, remove) =>
      planInlineUpdate(ctx, found, kind, patch, remove),
    delete: (ctx, found) => planInlineDelete(ctx, found, kind),
  };
}
