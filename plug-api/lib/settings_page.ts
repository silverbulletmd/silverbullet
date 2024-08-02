import { system } from "$sb/syscalls.ts";

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
  return await system.getSpaceConfig(key) ?? defaultValue;
}
