import { syscall } from "../syscall.ts";

/**
 * Gets a config value by path, with support for dot notation.
 * @param path The path to get the value from
 * @param defaultValue The default value to return if the path doesn't exist
 * @returns The value at the path, or the default value
 */
export function get<T>(path: string | string[], defaultValue: T): Promise<T> {
  return syscall("config.get", path, defaultValue);
}

/**
 * Sets a config value by path, with support for dot notation.
 * @param path The path to set the value at
 * @param value The value to set
 */
export function set<T>(path: string, value: T): Promise<void>;
/**
 * Sets multiple config values at once.
 * @param values An object containing key-value pairs to set
 */
export function set(values: Record<string, any>): Promise<void>;
export function set<T>(
  pathOrValues: string | Record<string, any>,
  value?: T,
): Promise<void> {
  return syscall("config.set", pathOrValues, value);
}

/**
 * Inserts a config value into an array
 */
export function insert<T>(
  path: string | string[],
  value: T,
): Promise<void> {
  return syscall("config.insert", path, value);
}

/**
 * Checks if a config path exists.
 * @param path The path to check
 * @returns True if the path exists, false otherwise
 */
export function has(path: string): Promise<boolean> {
  return syscall("config.has", path);
}

/**
 * Defines a JSON schema for a configuration key.
 * The schema will be used to validate values when setting this key.
 * @param key The configuration key to define a schema for
 * @param schema The JSON schema to validate against
 */
export function define(key: string, schema: any): Promise<void> {
  return syscall("config.define", key, schema);
}
