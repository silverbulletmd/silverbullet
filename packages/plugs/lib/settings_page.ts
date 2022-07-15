import { readYamlPage } from "./yaml_page";

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
