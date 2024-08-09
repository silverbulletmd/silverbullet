import { syscall } from "../syscall.ts";

/**
 * YAML operations
 * @module
 */

/**
 * Parses a YAML string into a JavaScript object.
 * @param text the YAML text to parse
 * @returns a JavaScript object representation of the YAML text
 */
export function parse(
  text: string,
): Promise<any> {
  return syscall("yaml.parse", text);
}

/**
 * Converts a JavaScript object into a YAML string.
 * @param obj the object to stringify
 * @returns a YAML string representation of the object
 */
export function stringify(
  obj: any,
): Promise<string> {
  return syscall("yaml.stringify", obj);
}
