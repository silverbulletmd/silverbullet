import YAML from "js-yaml";
import { INDEX_TEMPLATE, SETTINGS_TEMPLATE } from "./PAGE_TEMPLATES.ts";
import type { SpacePrimitives } from "./spaces/space_primitives.ts";
import { cleanupJSON } from "../plug-api/lib/json.ts";
import type {
  BuiltinSettings,
  DynamicAttributeDefinitionSettings,
} from "$type/settings.ts";
import type {
  DataStore,
  DynamicAttributeDefinitions,
  ObjectEnricher,
} from "$lib/data/datastore.ts";
import { parseExpression } from "$common/expression_parser.ts";
import type { System } from "$lib/plugos/system.ts";
import type { ConfigObject } from "../plugs/index/config.ts";
import { deepObjectMerge } from "$sb/lib/json.ts";

const yamlSettingsRegex = /^(```+|~~~+)ya?ml\r?\n([\S\s]+?)\1/m;

export const defaultSettings: BuiltinSettings = {
  indexPage: "index",
  hideSyncButton: false,
  maximumAttachmentSize: 10, // MiB
  defaultLinkStyle: "wikilink", // wikilink [[]] or markdown []()
  actionButtons: [
    {
      icon: "Home",
      description: "Go to the index page",
      command: "Navigate: Home",
    },
    {
      icon: "Book",
      description: `Open page`,
      command: "Navigate: Page Picker",
    },
    {
      icon: "Terminal",
      description: `Run command`,
      command: "Open Command Palette",
    },
  ],
};

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
  const yaml = match[2]; // The first group captures the code fence to look for same terminator
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
 * Loads space-configs from a system using the `index` plug.
 * @param system - The system object
 * @returns A promise that resolves to merged settings
 */
async function loadConfigsFromSystem(
  system: System<any>,
): Promise<BuiltinSettings> {
  if (!system.loadedPlugs.has("index")) {
    console.warn("Index plug not loaded yet, falling back to default settings");
    return defaultSettings;
  }
  // Query all space-configs
  const allConfigs: ConfigObject[] = await system.invokeFunction(
    "index.queryObjects",
    ["space-config", {}],
  );
  let settings: any = { ...defaultSettings };
  // Now let's intelligently merge them
  for (const config of allConfigs) {
    settings = deepObjectMerge(settings, { [config.key]: config.value });
  }
  // And clean up the JSON (expand .-separated paths, convert dates to strings)
  settings = cleanupJSON(settings);
  return settings;
}

/**
 * Ensures that the settings and index page exist in the given space.
 * If they don't exist, default settings and index page will be created.
 * @param space - The SpacePrimitives object representing the space.
 * @returns A promise that resolves to the built-in settings.
 */
export async function ensureAndLoadSettingsAndIndex(
  space: SpacePrimitives,
  system?: System<any>,
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
      return defaultSettings;
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
      // This should trigger indexing of the configs too
      await space.writeFile(
        "index.md",
        new TextEncoder().encode(INDEX_TEMPLATE),
      );
    }
  }
  if (system) {
    // If we're not in SB_SYNC_ONLY, we can load settings from the index (ideal case)
    const settings = await loadConfigsFromSystem(system);
    console.log("Loaded settings from system", settings);
    return settings;
  } else {
    // If we are in SB_SYNC_ONLY, this is best effort, and we can only support settings in the SETTINGS.md file
    let settings: any = parseYamlSettings(settingsText);
    settings = cleanupJSON(settings);
    settings = { ...defaultSettings, ...settings };
    // console.log("Loaded settings from SETTINGS.md", settings);
    return settings;
  }
}

export function updateObjectDecorators(
  settings: BuiltinSettings,
  ds: DataStore,
) {
  if (settings.objectDecorators) {
    // Reload object decorators
    const newDecorators: ObjectEnricher[] = [];
    for (
      const decorator of settings.objectDecorators
    ) {
      try {
        newDecorators.push({
          where: parseExpression(decorator.where),
          attributes: objectAttributeToExpressions(decorator.attributes),
        });
      } catch (e: any) {
        console.error(
          "Error parsing object decorator",
          decorator,
          "got error",
          e.message,
        );
      }
    }
    console.info(`Loaded ${newDecorators.length} object decorators`);
    ds.objectEnrichers = newDecorators;
  }
}

function objectAttributeToExpressions(
  dynamicAttributes: DynamicAttributeDefinitionSettings,
): DynamicAttributeDefinitions {
  const result: DynamicAttributeDefinitions = {};
  for (const [key, value] of Object.entries(dynamicAttributes)) {
    if (typeof value === "string") {
      result[key] = parseExpression(value);
    } else {
      result[key] = objectAttributeToExpressions(value);
    }
  }
  return result;
}
