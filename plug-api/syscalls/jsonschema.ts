import { syscall } from "$sb/syscall.ts";

export function validateObject(
  schema: any,
  object: any,
): Promise<any> {
  return syscall("jsonschema.validateObject", schema, object);
}
