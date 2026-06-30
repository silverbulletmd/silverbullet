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

/**
 * Validates a JSON schema.
 * @param schema the JSON schema to validate
 * @returns an error message if the schema is invalid, or undefined if it is valid
 */
export function validateSchema(schema: any): Promise<string | undefined> {
  return syscall("jsonschema.validateSchema", schema);
}

/**
 * Infers a best-effort JSON schema from a sample value's shape.
 * @param object the sample value to infer a schema from
 * @returns an inferred JSON schema (draft 2020-12), marked `x-inferred`
 */
export function inferFromObject(object: any): Promise<any> {
  return syscall("jsonschema.inferFromObject", object);
}
