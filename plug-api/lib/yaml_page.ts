import { findNodeOfType, traverseTree } from "$sb/lib/tree.ts";
import { markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import * as YAML from "yaml";

export async function readYamlPage(
  pageName: string,
  allowedLanguages = ["yaml"],
): Promise<any> {
  const text = await space.readPage(pageName);
  const tree = await markdown.parseMarkdown(text);
  let data: any = {};

  traverseTree(tree, (t): boolean => {
    // Find a fenced code block
    if (t.type !== "FencedCode") {
      return false;
    }
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return false;
    }
    if (!allowedLanguages.includes(codeInfoNode.children![0].text!)) {
      return false;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return false;
    }
    const codeText = codeTextNode.children![0].text!;
    try {
      data = YAML.parse(codeText);
    } catch (e: any) {
      console.error("YAML Page parser error", e);
      throw new Error(`YAML Error: ${e.message}`);
    }
    return true;
  });

  return data;
}

export async function writeYamlPage(
  pageName: string,
  data: any,
): Promise<void> {
  const text = YAML.stringify(data);
  await space.writePage(pageName, "```yaml\n" + text + "\n```");
}
