import { syscall } from "../syscall.ts";

/**
 * Validates a JSON object against a JSON schema.
 * @param schema the JSON schema to validate against
 * @param object the JSON object to validate
 * @returns an error message if the object is invalid, or undefined if it is valid
 */
export function validateObject(
  schema: any,
  object: any,
): Promise<string | undefined> {
  return syscall("jsonschema.validateObject", schema, object);
}
