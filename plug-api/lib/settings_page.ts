import { system } from "@silverbulletmd/silverbullet/syscalls";
import { readYamlPage } from "@silverbulletmd/silverbullet/lib/yaml_page";

/**
 * Retrieves a setting from the space configuration.
 * @deprecated Use use `editor.getSpaceConfig` syscall instead
 * @param key string
 * @param defaultValue
 * @returns
 */
export async function readSetting(
  key: string,
  defaultValue?: any,
): Promise<any> {
  try {
    return await system.getSpaceConfig(key) ?? defaultValue;
  } catch {
    // We're running an old version of SilverBullet, fallback to reading from SETTINGS page
    try {
      const allSettings = (await readYamlPage("SETTINGS")) || {};
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
}
