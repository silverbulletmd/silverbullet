import { findNodeOfType, traverseTree } from "./tree.ts";
import { markdown, space, YAML } from "../syscalls.ts";

export async function readCodeBlockPage(
  pageName: string,
  allowedLanguages?: string[],
): Promise<string | undefined> {
  const text = await space.readPage(pageName);
  const tree = await markdown.parseMarkdown(text);
  let codeText: string | undefined;

  traverseTree(tree, (t): boolean => {
    // Find a fenced code block
    if (t.type !== "FencedCode") {
      return false;
    }
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (allowedLanguages && !codeInfoNode) {
      return false;
    }
    if (
      allowedLanguages &&
      !allowedLanguages.includes(codeInfoNode!.children![0].text!)
    ) {
      return false;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return false;
    }
    codeText = codeTextNode.children![0].text!;
    return true;
  });

  return codeText;
}

export async function readYamlPage(
  pageName: string,
  allowedLanguages = ["yaml"],
): Promise<any> {
  const codeText = await readCodeBlockPage(pageName, allowedLanguages);
  if (codeText === undefined) {
    return undefined;
  }
  try {
    return YAML.parse(codeText);
  } catch (e: any) {
    console.error("YAML Page parser error", e);
    throw new Error(`YAML Error: ${e.message}`);
  }
}

export async function writeYamlPage(
  pageName: string,
  data: any,
  prelude = "",
): Promise<void> {
  const text = await YAML.stringify(data);
  await space.writePage(pageName, prelude + "```yaml\n" + text + "\n```");
}
