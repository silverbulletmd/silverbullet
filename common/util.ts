import { SETTINGS_TEMPLATE } from "./settings_template.ts";
import { YAML } from "./deps.ts";
import { Space } from "./spaces/space.ts";

export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

export function isMacLike() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

// TODO: This is naive, may be better to use a proper parser
const yamlSettingsRegex = /```yaml([^`]+)```/;

export function parseYamlSettings(settingsMarkdown: string): {
  [key: string]: any;
} {
  const match = yamlSettingsRegex.exec(settingsMarkdown);
  if (!match) {
    return {};
  }
  const yaml = match[1];
  try {
    return YAML.parse(yaml) as {
      [key: string]: any;
    };
  } catch (e: any) {
    console.error("Error parsing SETTINGS as YAML", e.message);
    return {};
  }
}

export async function ensureAndLoadSettings(
  space: Space,
  dontCreate: boolean,
): Promise<any> {
  if (dontCreate) {
    return {
      indexPage: "index",
    };
  }
  try {
    await space.getPageMeta("SETTINGS");
  } catch {
    await space.writePage(
      "SETTINGS",
      SETTINGS_TEMPLATE,
      true,
    );
  }

  const { text: settingsText } = await space.readPage("SETTINGS");
  const settings = parseYamlSettings(settingsText);
  if (!settings.indexPage) {
    settings.indexPage = "index";
  }

  try {
    await space.getPageMeta(settings.indexPage);
  } catch {
    await space.writePage(
      settings.indexPage,
      `Welcome to your new space!`,
    );
  }

  return settings;
}
