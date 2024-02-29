import { readYamlPage } from "./yaml_page.ts";
import { editor, space, YAML } from "../syscalls.ts";

/**
 * Convenience function to read a specific set of settings from the `SETTINGS` page as well as default values
 * in case they are not specified.
 * Example: `await readSettings({showPreview: false})` will return an object like `{showPreview: false}` (or `true`)
 * in case this setting is specifically set in the `SETTINGS` page.
 *
 * @param settings object with settings to fetch and their default values
 * @returns an object with the same shape as `settings` but with non-default values override based on `SETTINGS`
 */

const SETTINGS_PAGE = "SETTINGS";

export async function readSettings<T extends object>(settings: T): Promise<T> {
  try {
    const allSettings = (await readYamlPage(SETTINGS_PAGE, ["yaml"])) || {};
    // TODO: I'm sure there's a better way to type this than "any"
    const collectedSettings: any = {};
    for (const [key, defaultVal] of Object.entries(settings)) {
      if (key in allSettings) {
        collectedSettings[key] = allSettings[key];
      } else {
        collectedSettings[key] = defaultVal;
      }
    }
    return collectedSettings as T;
  } catch (e: any) {
    if (e.message === "Not found") {
      // No settings yet, return default values for all
      return settings;
    }
    throw e;
  }
}

export async function readSetting(
  key: string,
  defaultValue?: any,
): Promise<any> {
  try {
    const allSettings = (await readYamlPage(SETTINGS_PAGE, ["yaml"])) || {};
    const val = allSettings[key];
    return val === undefined ? defaultValue : val;
  } catch (e: any) {
    if (e.message === "Not found") {
      // No settings yet, return default values for all
      return defaultValue;
    }
    throw e;
  }
}

/**
 * Convenience function to write a specific set of settings from the `SETTINGS` page.
 * If the SETTiNGS page doesn't exist it will create it.
 * @param settings
 */
export async function writeSettings<T extends object>(settings: T) {
  let readSettings = {};
  try {
    readSettings = (await readYamlPage(SETTINGS_PAGE, ["yaml"])) || {};
  } catch {
    await editor.flashNotification("Creating a new SETTINGS page...", "info");
  }
  const writeSettings: any = { ...readSettings, ...settings };
  // const doc = new YAML.Document();
  // doc.contents = writeSettings;
  const contents =
    `This page contains settings for configuring SilverBullet and its Plugs.\nAny changes outside of the yaml block will be overwritten.\n\`\`\`yaml\n${await YAML
      .stringify(
        writeSettings,
      )}\n\`\`\``; // might need \r\n for windows?
  await space.writePage(SETTINGS_PAGE, contents);
}
