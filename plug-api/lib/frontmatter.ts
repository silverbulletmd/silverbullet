import { YAML } from "$sb/plugos-syscall/mod.ts";

import {
  addParentPointers,
  collectNodesOfType,
  ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";

export type FrontMatter = { tags: string[] } & Record<string, any>;

export type FrontmatterExtractOptions = {
  removeKeys?: string[];
  removeTags?: string[] | true;
  removeFrontmatterSection?: boolean;
};

// Extracts front matter from a markdown document
// optionally removes certain keys from the front matter
export async function extractFrontmatter(
  tree: ParseTree,
  options: FrontmatterExtractOptions = {},
): Promise<FrontMatter> {
  let data: FrontMatter = {
    tags: [],
  };
  addParentPointers(tree);
  let paragraphCounter = 0;

  await replaceNodesMatchingAsync(tree, async (t) => {
    // Find tags in the first paragraph to attach to the page
    if (t.type === "Paragraph") {
      paragraphCounter++;
      // Only attach hashtags in the first paragraph to the page
      if (paragraphCounter !== 1) {
        return;
      }
      collectNodesOfType(t, "Hashtag").forEach((h) => {
        const tagname = h.children![0].text!.substring(1);
        if (!data.tags.includes(tagname)) {
          data.tags.push(tagname);
        }
        if (
          options.removeTags === true || options.removeTags?.includes(tagname)
        ) {
          // Ugly hack to remove the hashtag
          h.children![0].text = "";
        }
      });
    }
    // Find FrontMatter and parse it
    if (t.type === "FrontMatter") {
      const yamlNode = t.children![1].children![0];
      const yamlText = renderToText(yamlNode);
      try {
        const parsedData: any = await YAML.parse(yamlText);
        const newData = { ...parsedData };
        data = { ...data, ...parsedData };
        // Make sure we have a tags array
        if (!data.tags) {
          data.tags = [];
        }
        // Normalize tags to an array and support a "tag1, tag2" notation
        if (typeof data.tags === "string") {
          data.tags = (data.tags as string).split(/,\s*/);
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
          Object.keys(newData).length === 0 || options.removeFrontmatterSection
        ) {
          return null;
        }
      } catch (e: any) {
        console.warn("Could not parse frontmatter", e.message);
      }
    }

    return undefined;
  });

  if (data.name) {
    data.displayName = data.name;
    delete data.name;
  }

  return data;
}

// Updates the front matter of a markdown document and returns the text as a rendered string
export async function prepareFrontmatterDispatch(
  tree: ParseTree,
  data: string | Record<string, any>,
): Promise<any> {
  let dispatchData: any = null;
  await traverseTreeAsync(tree, async (t) => {
    // Find FrontMatter and parse it
    if (t.type === "FrontMatter") {
      const bodyNode = t.children![1].children![0];
      const yamlText = renderToText(bodyNode);

      try {
        let frontmatterText = "";
        if (typeof data === "string") {
          frontmatterText = yamlText + data + "\n";
        } else {
          const parsedYaml = await YAML.parse(yamlText) as any;
          const newData = { ...parsedYaml, ...data };
          frontmatterText = await YAML.stringify(newData);
        }
        // Patch inline
        dispatchData = {
          changes: {
            from: bodyNode.from,
            to: bodyNode.to,
            insert: frontmatterText,
          },
        };
      } catch (e: any) {
        console.error("Error parsing YAML", e);
      }
      return true;
    }
    return false;
  });
  if (!dispatchData) {
    // If we didn't find frontmatter, let's add it
    let frontmatterText = "";
    if (typeof data === "string") {
      frontmatterText = data + "\n";
    } else {
      frontmatterText = await YAML.stringify(data);
    }
    const fullFrontmatterText = "---\n" + frontmatterText +
      "---\n";
    dispatchData = {
      changes: {
        from: 0,
        to: 0,
        insert: fullFrontmatterText,
      },
    };
  }
  return dispatchData;
}
