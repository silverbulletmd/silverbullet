import { readYamlPage } from "./yaml_page";

/**
 * Convenience function to read a specific set of settings from the `SETTINGS` page as well as default values
 * in case they are not specified.
 * Example: `await readSettings({showPreview: false})` will return an object like `{showPreview: false}` (or `true`)
 * in case this setting is specifically set in the `SETTINGS` page.
 *
 * @param settings object with settings to fetch and their default values
 * @returns an object with the same shape as `settings` but with non-default values override based on `SETTINGS`
 */

export async function readSettings<T extends object>(settings: T): Promise<T> {
  try {
    let allSettings = (await readYamlPage("SETTINGS", ["yaml"])) || {};
    // TODO: I'm sure there's a better way to type this than "any"
    let collectedSettings: any = {};
    for (let [key, defaultVal] of Object.entries(settings)) {
      if (allSettings[key]) {
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
