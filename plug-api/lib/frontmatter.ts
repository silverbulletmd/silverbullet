import {
  addParentPointers,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "./tree.ts";
import { cleanupJSON } from "./json.ts";
import { YAML } from "../syscalls.ts";
import { extractHashtag } from "./tags.ts";

export type FrontMatter = { tags?: string[] } & Record<string, any>;

export type FrontMatterExtractOptions = {
  removeKeys?: string[];
  removeTags?: string[] | true;
  removeFrontMatterSection?: boolean;
};

/**
 * Extracts front matter from a markdown document, as well as extracting tags that are to apply to the page
 * optionally removes certain keys from the front matter
 * Side effect: will add parent pointers
 */
export async function extractFrontMatter(
  tree: ParseTree,
  options: FrontMatterExtractOptions = {},
): Promise<FrontMatter> {
  let data: FrontMatter = {
    tags: [],
  };
  const tags: string[] = [];
  addParentPointers(tree);

  await replaceNodesMatchingAsync(tree, async (t) => {
    // Find tags in paragraphs directly nested under the document where the only content is tags
    if (t.type === "Paragraph" && t.parent?.type === "Document") {
      let onlyTags = true;
      const collectedTags = new Set<string>();
      for (const child of t.children!) {
        if (child.text) {
          if (child.text.startsWith("\n") && child.text !== "\n") {
            // Multi line paragraph, cut it off here
            break;
          }
          if (child.text.trim()) {
            // Text node with actual text (not just whitespace): not a page tag line!
            onlyTags = false;
            break;
          }
        } else if (child.type === "Hashtag") {
          const tagname = extractHashtag(child.children![0].text!);
          collectedTags.add(tagname);

          if (
            options.removeTags === true || options.removeTags?.includes(tagname)
          ) {
            // Ugly hack to remove the hashtag
            child.children![0].text = "";
          }
        } else if (child.type) {
          // Found something else than tags, so... nope!
          onlyTags = false;
          break;
        }
      }
      if (onlyTags) {
        tags.push(...collectedTags);
      }
    }
    // Find FrontMatter and parse it
    if (t.type === "FrontMatter") {
      const yamlNode = t.children![1].children![0];
      const yamlText = renderToText(yamlNode);
      try {
        const parsedData: any = await YAML.parse(yamlText);
        // console.log("Parsed front matter", parsedData);
        const newData = { ...parsedData };
        data = { ...data, ...parsedData };
        // Make sure we have a tags array
        if (!data.tags) {
          data.tags = [];
        }
        // Normalize tags to an array
        // support "tag1, tag2" as well as "tag1 tag2" as well as "#tag1 #tag2" notations
        if (typeof data.tags === "string") {
          tags.push(...(data.tags as string).split(/,\s*|\s+/));
        }
        if (Array.isArray(data.tags)) {
          tags.push(...data.tags);
        }

        if (options.removeKeys && options.removeKeys.length > 0) {
          let removedOne = false;

          for (const key of options.removeKeys) {
            if (key in newData) {
              delete newData[key];
              removedOne = true;
            }
          }
          if (removedOne) {
            yamlNode.text = await YAML.stringify(newData);
          }
        }
        // If nothing is left, let's just delete this whole block
        if (
          Object.keys(newData).length === 0 || options.removeFrontMatterSection
        ) {
          return null;
        }
      } catch {
        // console.warn("Could not parse frontmatter", e.message);
      }
    }

    return undefined;
  });

  try {
    data.tags = [
      ...new Set([...tags.map((t) => {
        // Always treat tags as strings
        const tagAsString = String(t);
        // Strip # from tags
        return tagAsString.replace(/^#/, "");
      })]),
    ];
  } catch (e) {
    console.error("Error while processing tags", e);
  }

  // console.log("Extracted tags", data.tags);
  // Expand property names (e.g. "foo.bar" => { foo: { bar: true } })
  data = cleanupJSON(data);

  return data;
}
