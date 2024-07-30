import YAML from "js-yaml";
import { INDEX_TEMPLATE, SETTINGS_TEMPLATE } from "./PAGE_TEMPLATES.ts";
import type { SpacePrimitives } from "./spaces/space_primitives.ts";
import { cleanupJSON } from "../plug-api/lib/json.ts";
import type { BuiltinSettings } from "$type/settings.ts";
import type { DataStore, ObjectEnricher } from "$lib/data/datastore.ts";
import { parseExpression } from "$common/expression_parser.ts";
import type { QueryExpression } from "$sb/types.ts";

const yamlSettingsRegex = /^(```+|~~~+)ya?ml\r?\n([\S\s]+?)\1/m;

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
 * Ensures that the settings and index page exist in the given space.
 * If they don't exist, default settings and index page will be created.
 * @param space - The SpacePrimitives object representing the space.
 * @returns A promise that resolves to the built-in settings.
 */
export async function ensureAndLoadSettingsAndIndex(
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
      await space.writeFile(
        "index.md",
        new TextEncoder().encode(INDEX_TEMPLATE),
      );
    }
  }

  const settings: any = parseYamlSettings(settingsText);
  cleanupJSON(settings);
  return { ...defaultSettings, ...settings };
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
        const parsedWhere = parseExpression(decorator.where);
        const parsedDynamicAttributes: Record<string, QueryExpression> = {};
        for (const [key, value] of Object.entries(decorator.attributes)) {
          parsedDynamicAttributes[key] = parseExpression(value);
        }
        newDecorators.push({
          where: parsedWhere,
          attributes: parsedDynamicAttributes,
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
