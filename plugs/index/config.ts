import type { IndexTreeEvent, ObjectValue } from "../../plug-api/types.ts";
import {
  findNodeOfType,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { indexObjects } from "./api.ts";
import { YAML } from "@silverbulletmd/silverbullet/syscalls";

export type ConfigObject = ObjectValue<{
  key: string;
  value: any;
}>;

export async function indexSpaceConfig({ name, tree }: IndexTreeEvent) {
  const allConfigs: ConfigObject[] = [];

  // Collect configs from all `space-config` fenced code blocks
  await traverseTreeAsync(tree, async (t): Promise<boolean> => {
    if (t.type !== "FencedCode") {
      return false;
    }
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return true;
    }

    const fenceType = codeInfoNode.children![0].text!;

    // If this is not a space-config nor a YAML block in SETTINGS, skip
    if (
      !(fenceType === "space-config" ||
        (name === "SETTINGS" && fenceType === "yaml"))
    ) {
      return true;
    }

    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return true;
    }
    const codeText = codeTextNode.children![0].text!;

    try {
      const parsedYaml = await YAML.parse(codeText);
      if (!parsedYaml) {
        return true;
      }
      // Check if parseYAML contains key-value style data
      for (const [key, value] of Object.entries(parsedYaml)) {
        allConfigs.push({
          ref: `${name}@${t.from!}:${key}`,
          tag: "space-config",
          key,
          value,
        });
      }
    } catch (e: any) {
      console.error("Error parsing config", codeText, e);
    }
    return true;
  });

  await indexObjects<ConfigObject>(name, allConfigs);
}
