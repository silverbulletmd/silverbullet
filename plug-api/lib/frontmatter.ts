import * as YAML from "yaml";

import {
  addParentPointers,
  findNodeOfType,
  ParseTree,
  renderToText,
  replaceNodesMatching,
  traverseTree,
} from "$sb/lib/tree.ts";

// Extracts front matter (or legacy "meta" code blocks) from a markdown document
// optionally removes certain keys from the front matter
export function extractFrontmatter(
  tree: ParseTree,
  removeKeys: string[] = [],
): any {
  let data: any = {};
  addParentPointers(tree);

  replaceNodesMatching(tree, (t) => {
    // Find top-level hash tags
    if (t.type === "Hashtag") {
      // Check if if nested directly into a Paragraph
      if (t.parent && t.parent.type === "Paragraph") {
        const tagname = t.children![0].text!.substring(1);
        if (!data.tags) {
          data.tags = [];
        }
        if (!data.tags.includes(tagname)) {
          data.tags.push(tagname);
        }
      }
      return;
    }
    // Find FrontMatter and parse it
    if (t.type === "FrontMatter") {
      const yamlNode = t.children![1].children![0];
      const yamlText = renderToText(yamlNode);
      try {
        const parsedData: any = YAML.parse(yamlText);
        const newData = { ...parsedData };
        data = { ...data, ...parsedData };
        if (removeKeys.length > 0) {
          let removedOne = false;

          for (const key of removeKeys) {
            if (key in newData) {
              delete newData[key];
              removedOne = true;
            }
          }
          if (removedOne) {
            yamlNode.text = YAML.stringify(newData);
          }
        }
        // If nothing is left, let's just delete this whole block
        if (Object.keys(newData).length === 0) {
          return null;
        }
      } catch (e: any) {
        console.error("Could not parse frontmatter", e);
      }
    }

    // Find a fenced code block with `meta` as the language type
    if (t.type !== "FencedCode") {
      return;
    }
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    if (codeInfoNode.children![0].text !== "meta") {
      return;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;
    const parsedData: any = YAML.parse(codeText);
    const newData = { ...parsedData };
    data = { ...data, ...parsedData };
    if (removeKeys.length > 0) {
      let removedOne = false;
      for (const key of removeKeys) {
        if (key in newData) {
          delete newData[key];
          removedOne = true;
        }
      }
      if (removedOne) {
        codeTextNode.children![0].text = YAML.stringify(newData).trim();
      }
    }
    // If nothing is left, let's just delete this whole block
    if (Object.keys(newData).length === 0) {
      return null;
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
export function prepareFrontmatterDispatch(
  tree: ParseTree,
  data: Record<string, any>,
): any {
  let dispatchData: any = null;
  traverseTree(tree, (t) => {
    // Find FrontMatter and parse it
    if (t.type === "FrontMatter") {
      const bodyNode = t.children![1].children![0];
      const yamlText = renderToText(bodyNode);

      try {
        const parsedYaml = YAML.parse(yamlText) as any;
        const newData = { ...parsedYaml, ...data };
        // Patch inline
        dispatchData = {
          changes: {
            from: bodyNode.from,
            to: bodyNode.to,
            insert: YAML.stringify(newData, { noArrayIndent: true }),
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
    dispatchData = {
      changes: {
        from: 0,
        to: 0,
        insert: "---\n" + YAML.stringify(data, { noArrayIndent: true }) +
          "---\n",
      },
    };
  }
  return dispatchData;
}
