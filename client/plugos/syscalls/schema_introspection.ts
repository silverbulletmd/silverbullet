/**
 * Pure schema-introspection helpers over the `["tags"]` config table.
 *
 * Returns raw JSON Schema objects; presentation-layer flattening (into typed
 * property rows) happens in the `sb describe` CLI (describe.rs).
 */

/**
 * Returns a map of tag name → raw JSON Schema for every tag that defines a schema.
 * Tags without a schema are omitted.
 */
export function describeSchemas(
  tags: Record<string, any>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(tags)) {
    if (def?.schema != null) {
      result[name] = def.schema;
    }
  }
  return result;
}

/**
 * Returns the raw JSON Schema for a single tag, or null if the tag is
 * undefined or has no schema.
 */
export function tagSchema(
  tags: Record<string, any>,
  tagName: string,
): unknown | null {
  return tags[tagName]?.schema ?? null;
}
