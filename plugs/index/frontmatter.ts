import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  type ParseTree,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/silverbullet/lib/tree";
import { cleanupJSON } from "@silverbulletmd/silverbullet/lib/json";
import YAML from "js-yaml";
import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import { determineTags } from "./cheap_yaml.ts";
import { stripPositionAttributes } from "./position_attributes.ts";
import { attributeCompletion } from "./complete.ts";

export type FrontMatter = {
  tags?: string[];
  // Location in the document where the frontmatter appears
  range?: [number, number];
} & Record<string, any>;

export type FrontMatterExtractOptions = {
  removeKeys?: string[];
  removeTags?: string[] | boolean;
  removeTagsPrefix?: string[];
  removeFrontMatterSection?: boolean;
};

function tagMatchesPrefix(tag: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (tag === prefix || tag.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts frontmatter from a markdown tree, as well as extracting tags and attributes that are to apply to the page
 * optionally removes certain keys from the front matter
 * Side effect: adds parent pointers to tree
 */
export function extractFrontMatter(
  tree: ParseTree,
  options: FrontMatterExtractOptions = {},
): FrontMatter {
  addParentPointers(tree);
  let frontmatter: FrontMatter = {
    tags: [],
  };
  const tags: string[] = [];

  replaceNodesMatching(tree, (t) => {
    // Find tags in paragraphs directly nested under the document where the only content is tags
    if (t.type === "Paragraph" && t.parent?.type === "Document") {
      let onlyTags = true;
      const collectedTags = new Set<string>();
      for (const child of t.children!) {
        if (child.text) {
          if (child.text.startsWith("\n") && child.text !== "\n") {
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
            options.removeTags === true ||
            (Array.isArray(options.removeTags) &&
              options.removeTags.includes(tagname)) ||
            (options.removeTagsPrefix &&
              tagMatchesPrefix(tagname, options.removeTagsPrefix))
          ) {
            // Ugly hack to remove the hashtag
            child.children![0].text = "";
          }
        } else if (child.type) {
          onlyTags = false;
          break;
        }
      }
      if (onlyTags) {
        tags.push(...collectedTags);
      }
    }
    if (t.type === "FrontMatter") {
      const yamlNode = t.children![1].children![0];
      const yamlText = renderToText(yamlNode);
      frontmatter.range = [t.from!, t.to!];
      try {
        const parsedData: any = cleanupJSON(YAML.load(yamlText));
        const newData = { ...parsedData };
        frontmatter = {
          ...frontmatter,
          ...stripPositionAttributes(parsedData),
        };
        if (!frontmatter.tags) {
          frontmatter.tags = [];
        }
        // Normalize tags to an array
        // support "tag1, tag2" as well as "tag1 tag2" as well as "#tag1 #tag2" notations
        if (typeof frontmatter.tags === "string") {
          tags.push(...(frontmatter.tags as string).split(/,\s*|\s+/));
        }
        if (Array.isArray(frontmatter.tags)) {
          tags.push(...frontmatter.tags);
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
            yamlNode.text = YAML.dump(newData);
          }
        }
        if (
          Object.keys(newData).length === 0 ||
          options.removeFrontMatterSection
        ) {
          return null;
        }
      } catch {}
    }
    if (t.type === "Attribute") {
      if (findParentMatching(t, (n) => n.type === "ListItem")) {
        return;
      }
      const nameNode = findNodeOfType(t, "AttributeName");
      const valueNode = findNodeOfType(t, "AttributeValue");
      if (nameNode && valueNode) {
        const name = nameNode.children![0].text!;
        const val = valueNode.children![0].text!;
        try {
          frontmatter[name] = cleanupJSON(YAML.load(val));
        } catch (e: any) {
          console.error("Error parsing attribute value as YAML", val, e);
        }
      }
      return;
    }

    return;
  });

  try {
    frontmatter.tags = [
      ...new Set([
        ...tags.map((t) => {
          const tagAsString = String(t);
          return tagAsString.replace(/^#/, "");
        }),
      ]),
    ];
  } catch (e) {
    console.error("Error while processing tags", e);
  }

  // Expand property names (e.g. "foo.bar" => { foo: { bar: true } })
  frontmatter = cleanupJSON(frontmatter);

  return frontmatter;
}

const attributeRegex = /^[\w\-_]+$/;

export async function frontmatterComplete(completeEvent: CompleteEvent) {
  const frontmatterCode = completeEvent.parentNodes.find((nt) =>
    nt.startsWith("FrontMatter:"),
  );

  if (!frontmatterCode) {
    return;
  }

  const attributeName = completeEvent.linePrefix;

  if (!attributeRegex.exec(attributeName)) {
    return;
  }

  const tags = determineTags(frontmatterCode);
  tags.push("page");

  return {
    from: completeEvent.pos - attributeName.length,
    options: await attributeCompletion(tags),
  };
}

/**
 * Rewrites the frontmatter YAML of `text` (parsed as `tree`) with `patch`,
 * which gets the current YAML, or "" when there is none. An empty result
 * removes the frontmatter.
 */
export function patchFrontmatterText(
  text: string,
  tree: ParseTree,
  patch: (yaml: string) => string,
): string {
  const frontmatter = findNodeOfType(tree, "FrontMatter");
  if (!frontmatter) {
    const yaml = patch("").trim();
    return yaml ? `---\n${yaml}\n---\n${text}` : text;
  }
  const yaml = patch(renderToText(frontmatter.children![1])).trim();
  return yaml
    ? `---\n${yaml}\n---${text.slice(frontmatter.to!)}`
    : text.slice(frontmatter.to! + 1); // +1 to skip the initial \n
}
