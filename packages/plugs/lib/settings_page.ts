import { flashNotification } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { readYamlPage, writeYamlPage } from "./yaml_page";

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
const SETTINGS_TEMPLATE = `This page contains settings for configuring SilverBullet and its Plugs:\n\`\`\`yaml\n\`\`\``; // might need \r\n for windows?

export async function readSettings<T extends object>(settings: T): Promise<T> {
  try {
    let allSettings = (await readYamlPage(SETTINGS_PAGE, ["yaml"])) || {};
    // TODO: I'm sure there's a better way to type this than "any"
    let collectedSettings: any = {};
    for (let [key, defaultVal] of Object.entries(settings)) {
      if (key in allSettings) {
        collectedSettings[key] = allSettings[key];
      } else {
        collectedSettings[key] = defaultVal;
      }
    }
    return collectedSettings as T;
  } catch (e: any) {
    if (e.message === "Page not found") {
      // No settings yet, return default values for all
      return settings;
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
  } catch (e: any) {
    console.log("Couldn't read settings, generating a new settings page");
    flashNotification("Creating a new SETTINGS page...", "info");
  }
  const writeSettings = {...readSettings, ...settings};
  if(await writeYamlPage(SETTINGS_PAGE, writeSettings, SETTINGS_TEMPLATE)) {
    flashNotification("SETTINGS page written successfully", "info");
  } else {
    flashNotification("SETTINGS page failed to update", "error");
  }
}