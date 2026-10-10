import {
  encodePageURI,
  encodeRef,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { Tag } from "./html_render.ts";
import type { SourcedNode } from "./inline.ts";

type RenderChildren = (children: ParseTree[]) => Tag[];

export function wikiLinkTag(
  t: ParseTree,
  shortWikiLinks: boolean | undefined,
  renderChildren: RenderChildren,
): Tag {
  const link = findNodeOfType(t, "WikiLinkPage")!.children![0].text!;
  let linkText = shortWikiLinks === true ? link.split("/").pop()! : link;
  const aliasNode = findNodeOfType(t, "WikiLinkAlias");
  const richAlias = aliasNode?.children?.some((c) => c.type);
  if (aliasNode && !richAlias) {
    linkText = aliasNode.children![0].text!;
  }

  // For invalid refs the link just won't link
  let href: string = `#`;

  const ref = parseToRef(link);
  if (ref) {
    href = `/${encodePageURI(encodeRef(ref))}`;
  }

  return {
    name: "a",
    attrs: {
      href,
      class: "wiki-link",
      "data-ref": link,
    },
    body: richAlias ? renderChildren(aliasNode!.children!) : linkText,
  };
}

export function attributeTag(
  t: ParseTree,
  renderChildren: RenderChildren,
): Tag {
  const nameNode = findNodeOfType(t, "AttributeName");
  const valueNode = findNodeOfType(t, "AttributeValue");
  const colonNode = findNodeOfType(t, "AttributeColon");
  const attrName = nameNode?.children?.[0].text ?? "";
  const attrValue = valueNode
    ? ((valueNode as SourcedNode).source ?? renderToText(valueNode))
    : "";
  const richValue = valueNode?.children?.some((c) => c.type);
  const attrColon = colonNode?.children?.[0].text ?? ": ";
  return {
    name: "span",
    attrs: {
      class: "sb-attribute",
      ...(attrName ? { [`data-${attrName}`]: attrValue } : {}),
    },
    body: [
      {
        name: "span",
        attrs: { class: "sb-frontmatter sb-meta" },
        body: "[",
      },
      {
        name: "span",
        attrs: { class: "sb-frontmatter sb-attribute-name" },
        body: attrName,
      },
      {
        name: "span",
        attrs: { class: "sb-frontmatter sb-meta" },
        body: attrColon,
      },
      {
        name: "span",
        attrs: { class: "sb-frontmatter sb-attribute-value" },
        body: richValue ? renderChildren(valueNode!.children!) : attrValue,
      },
      {
        name: "span",
        attrs: { class: "sb-frontmatter sb-meta" },
        body: "]",
      },
    ],
  };
}
