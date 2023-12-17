import { SETTINGS_TEMPLATE } from "./settings_template.ts";
import { YAML } from "./deps.ts";
import { SpacePrimitives } from "./spaces/space_primitives.ts";
import { expandPropertyNames } from "$sb/lib/json.ts";

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
    return YAML.load(yaml) as {
      [key: string]: any;
    };
  } catch (e: any) {
    console.error("Error parsing SETTINGS as YAML", e.message);
    return {};
  }
}

export async function ensureSettingsAndIndex(
  space: SpacePrimitives,
): Promise<any> {
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
      console.error("Falling back to default settings");
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

  const settings = parseYamlSettings(settingsText);
  expandPropertyNames(settings);
  return settings;
}
