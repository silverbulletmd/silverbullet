import { SETTINGS_TEMPLATE } from "./settings_template.ts";
import { YAML } from "./deps.ts";
import { SpacePrimitives } from "./spaces/space_primitives.ts";
import { expandPropertyNames } from "$sb/lib/json.ts";
import type { BuiltinSettings } from "../web/types.ts";

/**
 * Runs a function safely by catching any errors and logging them to the console.
 * @param fn - The function to run.
 */
export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

/**
 * Checks if the current platform is Mac-like (Mac, iPhone, iPod, iPad).
 * @returns A boolean indicating if the platform is Mac-like.
 */
export function isMacLike() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

// TODO: This is naive, may be better to use a proper parser
const yamlSettingsRegex = /```yaml([^`]+)```/;

/**
 * Parses YAML settings from a Markdown string.
 * @param settingsMarkdown - The Markdown string containing the YAML settings.
 * @returns An object representing the parsed YAML settings.
 */
export function parseYamlSettings(settingsMarkdown: string): {
  [key: string]: any;
} {
  const match = yamlSettingsRegex.exec(settingsMarkdown);
  if (!match) {
    return {};
  }
  const yaml = match[1];
  try {
    return YAML.load(yaml) as {
      [key: string]: any;
    };
  } catch (e: any) {
    console.error("Error parsing SETTINGS as YAML", e.message);
    return {};
  }
}

/**
 * Ensures that the settings and index page exist in the given space.
 * If they don't exist, default settings and index page will be created.
 * @param space - The SpacePrimitives object representing the space.
 * @returns A promise that resolves to the built-in settings.
 */
export async function ensureSettingsAndIndex(
  space: SpacePrimitives,
): Promise<BuiltinSettings> {
  let settingsText: string | undefined;
  try {
    settingsText = new TextDecoder().decode(
      (await space.readFile("SETTINGS.md")).data,
    );
  } catch (e: any) {
    if (e.message === "Not found") {
      console.log("No settings found, creating default settings");
      await space.writeFile(
        "SETTINGS.md",
        new TextEncoder().encode(SETTINGS_TEMPLATE),
        true,
      );
    } else {
      console.error("Error reading settings", e.message);
      console.warn("Falling back to default settings");
      return {
        indexPage: "index",
      };
    }
    settingsText = SETTINGS_TEMPLATE;
    // Ok, then let's also check the index page
    try {
      await space.getFileMeta("index.md");
    } catch (e: any) {
      console.log(
        "No index page found, creating default index page",
        e.message,
      );
      await space.writeFile(
        "index.md",
        new TextEncoder().encode(
          `Hello! And welcome to your brand new SilverBullet space!

\`\`\`template
page: "[[!silverbullet.md/Getting Started]]"
\`\`\`
`,
        ),
      );
    }
  }

  const settings: any = parseYamlSettings(settingsText);
  expandPropertyNames(settings);
  return settings;
}
