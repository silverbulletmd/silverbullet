import YAML from "js-yaml";
import { patchFrontmatterText } from "./frontmatter.ts";
import {
  minimalEdit,
  type PlanContext,
  patchYaml,
  type TextEdit,
} from "./object_edit.ts";

export const PAGE_READ_ONLY = [
  "ref",
  "tag",
  "itags",
  "name",
  "perm",
  "lastModified",
  "created",
  "contentType",
  "size",
];

export function planPageUpdate(
  ctx: PlanContext,
  patch: Record<string, unknown>,
  remove: string[],
  order?: string[],
): TextEdit[] {
  const after = patchFrontmatterText(ctx.text, ctx.tree, (yaml) =>
    patchYaml(yaml.replace(/\n$/, ""), patch, remove, order),
  );
  return minimalEdit(ctx.text, after);
}

export function renderNewPage(
  attributes: Record<string, unknown>,
  body: string,
): string {
  if (Object.keys(attributes).length === 0) return body;
  return `---\n${YAML.dump(attributes, { lineWidth: -1 }).trimEnd()}\n---\n${body}`;
}
