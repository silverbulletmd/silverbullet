import YAML from "js-yaml";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { dataBlocks, splitYamlDocuments } from "./data.ts";
import {
  DERIVED,
  movedError,
  type ObjectHandler,
  type PlanContext,
  patchYaml,
  type TextEdit,
  trimmedEnd,
  wholeLines,
  withoutTag,
} from "./object_edit.ts";

const trimDocument = (s: string) => s.replace(/^\n/, "").replace(/\n$/, "");

function locate(ctx: PlanContext, found: ObjectValue<any>) {
  for (const block of dataBlocks(ctx.tree)) {
    if (!block.code) continue;
    const code = block.code;
    const docs = splitYamlDocuments(renderToText(code)).map((d) => ({
      text: d.text,
      from: code.from! + d.offset,
    }));
    const index = docs.findIndex((d) => d.from === found.range[0]);
    if (index >= 0) return { code, fence: block.fence, docs, index };
  }
  throw movedError(found.page);
}

// Each edit stays within its own document, so several documents of one
// block can change in a single batch
export function planDataUpdate(
  ctx: PlanContext,
  found: ObjectValue<any>,
  patch: Record<string, unknown>,
  remove: string[],
): TextEdit[] {
  const { docs, index } = locate(ctx, found);
  const doc = docs[index];
  const lead = doc.text.startsWith("\n") ? "\n" : "";
  const trail =
    doc.text.length > lead.length && doc.text.endsWith("\n") ? "\n" : "";
  const yaml = patchYaml(trimDocument(doc.text), patch, remove);
  return [
    {
      from: doc.from,
      to: doc.from + doc.text.length,
      insert: lead + yaml + trail,
    },
  ];
}

export function planDataDelete(
  ctx: PlanContext,
  found: ObjectValue<any>,
): TextEdit[] {
  const { text } = ctx;
  const { code, fence, docs, index } = locate(ctx, found);
  if (docs.length === 1) return [wholeLines(text, fence.from!, fence.to!)];
  const doc = docs[index];
  if (index < docs.length - 1) {
    // Up to the next document, taking the separator line with it
    let to = docs[index + 1].from;
    if (!doc.text.startsWith("\n") && text[to] === "\n") to++;
    return [{ from: doc.from, to, insert: "" }];
  }
  const previous = docs[index - 1];
  const separator = previous.from + previous.text.length;
  return [
    {
      from: separator - (previous.text.endsWith("\n") ? 1 : 0),
      to: code.to!,
      insert: "",
    },
  ];
}

export function planDataAppend(
  ctx: PlanContext,
  record: Record<string, unknown>,
  anchor: string | undefined,
): TextEdit[] {
  const tag = record.tag as string;
  const yaml = YAML.dump(
    { ...(anchor ? { $ref: anchor } : {}), ...withoutTag(record) },
    { lineWidth: -1 },
  ).trimEnd();
  const block = dataBlocks(ctx.tree)
    .filter((b) => b.tag === tag)
    .pop();
  if (block?.code) {
    const at = block.code.to!;
    return [{ from: at, to: at, insert: `\n---\n${yaml}` }];
  }
  if (block) {
    const at = block.info.to!;
    return [{ from: at, to: at, insert: `\n${yaml}` }];
  }
  const { text } = ctx;
  const from = trimmedEnd(text);
  const info = tag === "data" ? "data" : `#${tag}`;
  return [
    {
      from,
      to: text.length,
      insert: `${from === 0 ? "" : "\n\n"}\`\`\`${info}\n${yaml}\n\`\`\`\n`,
    },
  ];
}

export const dataHandler: ObjectHandler = {
  readOnly: DERIVED,
  update: planDataUpdate,
  delete: planDataDelete,
};
