import { findNodeOfType, traverseTree } from "../../common/tree.ts";
import { parseMarkdown } from "../../plugos-silverbullet-syscall/markdown.ts";
import {
  readPage,
  writePage,
} from "../../plugos-silverbullet-syscall/space.ts";
import * as YAML from "yaml";

export async function readYamlPage(
  pageName: string,
  allowedLanguages = ["yaml"],
): Promise<any> {
  const { text } = await readPage(pageName);
  let tree = await parseMarkdown(text);
  let data: any = {};

  traverseTree(tree, (t): boolean => {
    // Find a fenced code block
    if (t.type !== "FencedCode") {
      return false;
    }
    let codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return false;
    }
    if (!allowedLanguages.includes(codeInfoNode.children![0].text!)) {
      return false;
    }
    let codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return false;
    }
    let codeText = codeTextNode.children![0].text!;
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
  await writePage(pageName, "```yaml\n" + text + "\n```");
}
