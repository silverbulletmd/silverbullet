import {
  cloneTree,
  findParentMatching,
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { cleanTags, collectTags, updateITags } from "./tags.ts";
import type { FrontMatter } from "./frontmatter.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { system } from "@silverbulletmd/silverbullet/syscalls";
import { cleanAttributes, collectAttributes } from "./attribute.ts";
import { collectPageLinks } from "./link.ts";

export type ItemObject = ObjectValue<
  {
    page: string;
    name: string;
    text: string;
    pos: number;
    parent?: string;
    links?: string[];
    ilinks?: string[];
  } & Record<string, any>
>;

export type TaskObject = ObjectValue<
  // "Inherit" everyting from item
  & ItemObject
  // And add a few more attributes
  & {
    done: boolean;
    state: string;
  }
  & Record<string, any>
>;

const completeStates = ["x", "X"];

export async function indexItems(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const shouldIndexAllItems = await system.getConfig(
    "index.item.all",
    true,
  );
  const shouldIndexAllTasks = await system.getConfig(
    "index.task.all",
    true,
  );

  let items: ObjectValue<ItemObject | TaskObject>[] = [];

  traverseTree(tree, (n) => {
    if (n.type !== "ListItem") {
      return false;
    }

    if (!n.children) {
      // Weird, let's jump out
      return true;
    }

    items.push(extractItemFromNode(
      pageMeta.name,
      n,
      frontmatter,
    ));

    // Traversal continue into child items (potentially)
    return false;
  });

  if (!shouldIndexAllItems) {
    items = items.filter((item) => item.tag !== "item" || item.tags?.length);
  }
  if (!shouldIndexAllTasks) {
    items = items.filter((item) => item.tag !== "task" || item.tags?.length);
  }

  return items;
}

export function extractItemFromNode(
  name: string,
  itemNode: ParseTree,
  frontmatter: FrontMatter,
  withParents = true,
): ItemObject | TaskObject {
  const item: ItemObject | TaskObject = {
    ref: `${name}@${itemNode.from}`,
    tag: "item",
    pos: itemNode.from!,
    range: [itemNode.from!, itemNode.to!],
    name: "", // to be replaced
    text: "", // to be replaced
    page: name,
  };

  // This will only be valid for items, not task
  let nameNode = itemNode.children!.find((n) => n.type === "Paragraph");

  // Is this a task?
  const taskNode = itemNode.children!.find((n) => n.type === "Task");
  if (taskNode) {
    item.tag = "task";
    item.state = taskNode.children![0].children![1].text!;
    item.done = completeStates.includes(item.state);
    // Fake a paragraph node for text rendering later
    nameNode = { type: "Paragraph", children: taskNode.children!.slice(1) };
  }

  // Now let's extract tags and attributes
  const tags = collectTags(itemNode);
  const attributes = collectAttributes(itemNode);
  const links = collectPageLinks(itemNode);

  item.text = renderToText(nameNode).trim();

  const nameNodeClone = cloneTree(nameNode!);
  cleanTags(nameNodeClone);
  cleanAttributes(nameNodeClone);
  item.name = renderToText(nameNodeClone).trim();

  if (tags.length > 0) {
    item.tags = tags;
  }

  if (links.length > 0) {
    item.links = links;
    item.ilinks = links;
  }

  for (const [key, value] of Object.entries(attributes)) {
    item[key] = value;
  }

  updateITags(item, frontmatter);

  if (withParents) {
    enrichItemFromParents(itemNode, item, name, frontmatter);
  }

  return item;
}

export function enrichItemFromParents(
  n: ParseTree,
  item: ItemObject,
  pageName: string,
  frontmatter: FrontMatter,
) {
  let directParent = true;
  let parentItemNode = findParentMatching(n, (n) => n.type === "ListItem");
  while (parentItemNode) {
    const parentItem = extractItemFromNode(
      pageName,
      parentItemNode,
      frontmatter,
      false,
    );
    if (directParent) {
      item.parent = parentItem.ref;
      directParent = false;
    }
    // Merge tags
    item.itags = [
      ...new Set([
        ...item.itags || [],
        ...(parentItem.itags!.filter((t) => !["item", "task"].includes(t))),
      ]),
    ];

    // And links
    const ilinks = [
      ...new Set([
        ...item.ilinks || [],
        ...parentItem.ilinks || [],
      ]),
    ];
    if (ilinks.length > 0) {
      item.ilinks = ilinks;
    }

    parentItemNode = findParentMatching(
      parentItemNode,
      (n) => n.type === "ListItem",
    );
  }
}
