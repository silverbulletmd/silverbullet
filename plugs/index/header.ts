import {
  cloneTree,
  collectNodesMatching,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { index, lua } from "@silverbulletmd/silverbullet/syscalls";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import type { FrontMatter } from "./frontmatter.ts";
import { cleanAttributes, collectAttributes } from "./attribute.ts";
import { cleanTags, collectTags } from "./tags.ts";

type HeaderObject = ObjectValue<
  {
    name: string;
    text: string;
    page: string;
    level: number;
    pos: number;
  } & Record<string, any>
>;

export function indexHeaders(
  pageMeta: PageMeta,
  _frontmatter: FrontMatter,
  tree: ParseTree,
): Promise<HeaderObject[]> {
  const headers: ObjectValue<HeaderObject>[] = [];

  for (
    const n of collectNodesMatching(
      tree,
      (t) => !!t.type?.startsWith("ATXHeading"),
    )
  ) {
    const level = +n.type!.substring("ATXHeading".length);
    const name = renderToText(n).slice(level + 1);
    const tags = collectTags(n);
    const attributes = collectAttributes(n);
    const nClone = cloneTree(n);
    cleanTags(nClone);
    cleanAttributes(nClone);
    const text = renderToText(nClone).slice(level + 1);

    headers.push({
      ref: `${pageMeta.name}@${n.from}`,
      tag: "header",
      tags: [...tags],
      level,
      name,
      text,
      page: pageMeta.name,
      pos: n.from!,
      ...attributes,
    });
  }

  return Promise.resolve(headers);
}

export async function headerComplete(completeEvent: CompleteEvent) {
  const match = /(?:\[\[|\[.*?\]\()(?<path>[^\[]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!match || !match.groups?.path) {
    return;
  }

  const ref = parseToRef(match.groups.path);
  if (!ref || ref.details?.type !== "header") {
    return;
  }

  const headers = await index.queryLuaObjects<HeaderObject>(
    "header",
    {
      objectVariable: "_",
      where: await lua.parseExpression(`_.page == name`),
    },
    { name: getNameFromPath(ref.path) || completeEvent.pageName },
  );

  return {
    from: completeEvent.pos - match.groups.path.length,
    options: headers.map((header) => ({
      label: `${
        (ref.meta ? "^" : "") + getNameFromPath(ref.path)
      }#${header.name}`,
      type: "header",
    })),
  };
}
