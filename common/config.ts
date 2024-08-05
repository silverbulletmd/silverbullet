import YAML from "js-yaml";
import { INDEX_TEMPLATE, SETTINGS_TEMPLATE } from "./PAGE_TEMPLATES.ts";
import type { SpacePrimitives } from "./spaces/space_primitives.ts";
import { cleanupJSON } from "../plug-api/lib/json.ts";
import type {
  Config,
  DynamicAttributeDefinitionConfig,
} from "../type/config.ts";
import type {
  DataStore,
  DynamicAttributeDefinitions,
  ObjectDecorators,
} from "$lib/data/datastore.ts";
import { parseExpression } from "$common/expression_parser.ts";
import type { System } from "$lib/plugos/system.ts";
import type { ConfigObject } from "../plugs/index/config.ts";
import { deepObjectMerge } from "@silverbulletmd/silverbullet/lib/json";
import type { ActionButton } from "@silverbulletmd/silverbullet/type/client";

const yamlConfigRegex = /^(```+|~~~+)(ya?ml|space-config)\r?\n([\S\s]+?)\1/m;

export const defaultConfig: Config = {
  indexPage: "index",
  hideSyncButton: false,
  maximumAttachmentSize: 10, // MiB
  defaultLinkStyle: "wikilink", // wikilink [[]] or markdown []()
  actionButtons: [], // Actually defaults to defaultActionButtons
};

export const defaultActionButtons: ActionButton[] = [
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
];

export interface ConfigContainer {
  config: Config;

  loadConfig(): Promise<void>;
}

/**
 * Parses YAML config from a Markdown string.
 * @param configMarkdown - The Markdown string containing the YAML config.
 * @returns An object representing the parsed YAML config.
 */
export function parseYamlConfig(configMarkdown: string): {
  [key: string]: any;
} {
  const match = yamlConfigRegex.exec(configMarkdown);
  if (!match) {
    return {};
  }
  const yaml = match[3];
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
 * @returns A promise that resolves to merged configs from the system.
 */
async function loadConfigsFromSystem(
  system: System<any>,
): Promise<Config> {
  if (!system.loadedPlugs.has("index")) {
    console.warn("Index plug not loaded yet, falling back to default config");
    return defaultConfig;
  }
  // Query all space-configs
  const allConfigs: ConfigObject[] = await system.invokeFunction(
    "index.queryObjects",
    ["space-config", {}],
  );
  let fullConfig: any = { ...defaultConfig };
  // Now let's intelligently merge them
  for (const config of allConfigs) {
    fullConfig = deepObjectMerge(fullConfig, { [config.key]: config.value });
  }
  // And clean up the JSON (expand .-separated paths, convert dates to strings)
  return cleanupJSON(fullConfig);
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
): Promise<Config> {
  let configText: string | undefined;

  try {
    configText = new TextDecoder().decode(
      (await space.readFile("SETTINGS.md")).data,
    );
  } catch (e: any) {
    if (e.message === "Not found") {
      console.log("No SETTINGS found, creating default SETTINGS");
      await space.writeFile(
        "SETTINGS.md",
        new TextEncoder().encode(SETTINGS_TEMPLATE),
        true,
      );
    } else {
      console.error("Error reading SETTINGS", e.message);
      console.warn("Falling back to default SETTINGS");
      return defaultConfig;
    }
    configText = SETTINGS_TEMPLATE;
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
    // If we're NOT in SB_SYNC_ONLY, we can load settings from the index (ideal case)
    return loadConfigsFromSystem(system);
  } else {
    // If we are in SB_SYNC_ONLY, this is best effort, and we can only support settings in the SETTINGS.md file
    let config: any = parseYamlConfig(configText);
    config = cleanupJSON(config);
    config = { ...defaultConfig, ...config };
    // console.log("Loaded settings from SETTINGS.md", config);
    return config;
  }
}

export function updateObjectDecorators(
  config: Config,
  ds: DataStore,
) {
  if (config.objectDecorators) {
    // Reload object decorators
    const newDecorators: ObjectDecorators[] = [];
    for (
      const decorator of config.objectDecorators
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
    // console.info(`Loaded ${newDecorators.length} object decorators`);
    ds.objectDecorators = newDecorators;
  }
}

function objectAttributeToExpressions(
  dynamicAttributes: DynamicAttributeDefinitionConfig,
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
