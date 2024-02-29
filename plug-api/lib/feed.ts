import {
  findNodeMatching,
  findNodeOfType,
  ParseTree,
  renderToText,
} from "./tree.ts";

/**
 * Feed parsing functionality (WIP)
 */

import { extractAttributes } from "$sb/lib/attribute.ts";

export type FeedItem = {
  id: string;
  title?: string;
  attributes?: Record<string, any>;
  text: string;
};

// tree = Document node
export async function extractFeedItems(tree: ParseTree): Promise<FeedItem[]> {
  let nodes: ParseTree[] = [];
  const feedItems: FeedItem[] = [];
  if (tree.type !== "Document") {
    throw new Error("Did not get a document");
  }
  // Run through the whole document to find the feed items
  for (const node of tree.children!) {
    if (node.type === "FrontMatter") {
      // Not interested
      console.log("Ignoring", node);
      continue;
    }
    if (node.type === "HorizontalRule") {
      // Ok we reached the end of a feed item
      feedItems.push(await nodesToFeedItem(nodes));
      nodes = [];
    } else {
      nodes.push(node);
    }
  }
  if (renderToText({ children: nodes }).trim().length > 0) {
    feedItems.push(await nodesToFeedItem(nodes));
  }

  return feedItems;
}

async function nodesToFeedItem(nodes: ParseTree[]): Promise<FeedItem> {
  const wrapperNode: ParseTree = {
    children: nodes,
  };
  const attributes = await extractAttributes(["feed"], wrapperNode, true);
  let id = attributes.id;
  delete attributes.id;
  if (!id) {
    const anchor = findNodeOfType(wrapperNode, "NamedAnchor");
    if (anchor) {
      id = anchor.children![0].text!.substring(1);
      if (id.startsWith("id/")) {
        id = id.substring(3);
      }
      // Empty it out
      anchor.children = [];
    }
  }

  // Find a title
  let title: string | undefined;
  const titleNode = findNodeMatching(
    wrapperNode,
    (node) => !!node.type?.startsWith("ATXHeading"),
  );
  if (titleNode) {
    title = titleNode.children![1].text!.trim();
    titleNode.children = [];
  }

  const text = renderToText(wrapperNode).trim();

  if (!id) {
    // If all else fails, generate content based ID
    id = `gen/${djb2Hash(JSON.stringify({ attributes, text }))}`;
  }
  //   console.log("Extracted attributes", attributes);
  const feedItem: FeedItem = { id, text };
  if (title) {
    feedItem.title = title;
  }
  if (Object.keys(attributes).length > 0) {
    feedItem.attributes = attributes;
  }
  return feedItem;
}

function djb2Hash(input: string): string {
  let hash = 5381; // Initial hash value

  for (let i = 0; i < input.length; i++) {
    // Update the hash value by shifting and adding the character code
    hash = (hash * 33) ^ input.charCodeAt(i);
  }

  // Convert the hash to a hexadecimal string representation
  return hash.toString(16);
}
