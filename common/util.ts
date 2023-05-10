import { SETTINGS_TEMPLATE } from "./settings_template.ts";
import { YAML } from "./deps.ts";
import { Space } from "./spaces/space.ts";
import { SpacePrimitives } from "./spaces/space_primitives.ts";

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

export async function ensureSettingsAndIndex(
  space: SpacePrimitives,
): Promise<any> {
  try {
    await space.getFileMeta("SETTINGS.md");
  } catch {
    await space.writeFile(
      "SETTINGS.md",
      "utf8",
      SETTINGS_TEMPLATE,
      true,
    );
    // Ok, then let's also write the index page
    try {
      await space.getFileMeta("index.md");
    } catch {
      await space.writeFile(
        "index.md",
        "utf8",
        `Hello! And welcome to your brand new SilverBullet space!
  
  <!-- #use [[💭 silverbullet.md/Getting Started]] -->
  Loading some onboarding content for you (but doing so does require a working internet connection)...
  <!-- /use -->`,
      );
    }
  }
}

export async function sha1(input: string): Promise<string> {
  // create a new instance of the SHA-1 algorithm
  const sha1Algo = "SHA-1";
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  const buffer = await crypto.subtle.digest(sha1Algo, data);

  // convert the buffer to a hex string
  const hexString = Array.prototype.map.call(
    new Uint8Array(buffer),
    function (x) {
      return ("00" + x.toString(16)).slice(-2);
    },
  ).join("");

  return hexString;
}
