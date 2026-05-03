import { type OutputUnit, Validator, format } from "@cfworker/json-schema";
import { stripFunctions } from "./plugos/util.ts";

// Register custom formats (shared with jsonschema.ts)
format.email = (data: string) => data.includes("@");
format["page-ref"] = (data: string) =>
  data.startsWith("[[") && data.endsWith("]]");

function cfwFormatErrors(errors: OutputUnit[]): string {
  // Filter out "properties" wrapper errors, keep only the specific leaf errors
  const leafErrors = errors.filter((e) => e.keyword !== "properties");
  const errorsToUse = leafErrors.length > 0 ? leafErrors : errors;

  return errorsToUse
    .map((e) => {
      // Convert instanceLocation from "#/foo/bar" to "foo.bar"
      const path =
        e.instanceLocation === "#"
          ? ""
          : e.instanceLocation.slice(2).replaceAll("/", ".");
      return path ? `${path}: ${e.error}` : e.error;
    })
    .join(", ");
}

/**
 * Validates that a value looks like a valid JSON schema.
 * Uses a lightweight structural check rather than full meta-schema validation.
 */
function isValidJsonSchema(schema: any): { valid: boolean; error?: string } {
  if (schema === null || schema === undefined) {
    return { valid: false, error: "schema must not be null or undefined" };
  }
  if (typeof schema === "boolean") {
    return { valid: true };
  }
  if (typeof schema !== "object" || Array.isArray(schema)) {
    return { valid: false, error: "schema must be an object or boolean" };
  }
  // Check that type, if specified, is valid
  if (schema.type !== undefined) {
    const validTypes = [
      "string",
      "number",
      "integer",
      "boolean",
      "object",
      "array",
      "null",
    ];
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (!validTypes.includes(t)) {
        return {
          valid: false,
          error: `schema.type must be one of ${validTypes.join(", ")}`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Configuration management (config.* APIs) for the client
 */
export type CategoryDefinition = {
  name: string;
  description?: string;
  order?: number;
};

export class Config {
  public schemas: Record<string, any> = {
    type: "object",
    properties: {},
  };

  /**
   * Registered UI categories for the configuration manager. Categories appear
   * in the UI in ascending `order`; categories referenced by a schema's
   * `ui.category` but never registered fall to the bottom in alphabetical order.
   */
  public categories: Record<string, CategoryDefinition> = {};

  constructor(public values: Record<string, any> = {}) {}

  public clear() {
    this.schemas = {
      type: "object",
      properties: {},
    };
    this.values = {};
    this.categories = {};
  }

  /**
   * Defines (or updates) a UI category for the configuration manager. The
   * category's `name` is the same string used in a schema field's
   * `ui.category`.
   */
  defineCategory(definition: CategoryDefinition): void {
    if (typeof definition?.name !== "string" || !definition.name) {
      throw new Error("defineCategory requires a non-empty name");
    }
    this.categories[definition.name] = { ...definition };
  }

  /**
   * Defines a JSON schema for a configuration key
   * @param key The configuration key to define a schema for
   * @param schema The JSON schema to validate against
   */
  define(key: string | string[], schema: any): void {
    // Validate the schema itself first
    const result = isValidJsonSchema(schema);
    if (!result.valid) {
      throw new Error(`Invalid schema for key ${key}: ${result.error}`);
    }

    if (typeof key === "string") {
      key = key.split(".");
    }

    // Navigate/create the path in the schema structure
    let current = this.schemas;
    for (let i = 0; i < key.length - 1; i++) {
      const part = key[i];
      if (!current.properties[part]) {
        current.properties[part] = {
          type: "object",
          properties: {},
        };
      }
      current = current.properties[part];
    }

    // Store the schema at the final key
    const finalKey = key[key.length - 1];
    current.properties[finalKey] = schema;

    // Apply default values from schema for any properties not currently set
    this.applySchemaDefaults(key, schema);
  }

  /**
   * Recursively applies default values from a schema definition.
   * Only sets a value if none exists at that path.
   */
  private applySchemaDefaults(path: string[], schema: any): void {
    if ("default" in schema) {
      if (!this.has(path)) {
        this.set(path, structuredClone(schema.default));
      }
    }
    if (schema.properties) {
      for (const [propKey, propSchema] of Object.entries(schema.properties)) {
        this.applySchemaDefaults([...path, propKey], propSchema as any);
      }
    }
  }

  /**
   * Gets a value from the config
   * @param path The path to get, supports dot notation (e.g. "foo.bar.baz")
   * @param defaultValue The default value to return if the path doesn't exist
   * @returns The value at the path, or the default value
   */
  get<T>(path: string | string[], defaultValue: T): T {
    if (typeof path === "string") {
      path = path.split(".");
    }
    const resolved = resolvePath(this.values, path);
    if (!resolved) {
      return defaultValue;
    }

    return (resolved.obj[resolved.key] ?? defaultValue) as T;
  }

  /**
   * Sets a value in the config
   * @param path The path to set, supports dot notation (e.g. "foo.bar.baz")
   * @param value The value to set
   */
  set<T>(path: string, value: T): void;
  /**
   * Sets a value in the config
   * @param path The path to set (one path element per array element)
   * @param value The value to set
   */
  set<T>(path: string[], value: T): void;

  /**
   * Sets multiple values in the config
   * @param values An object containing key-value pairs to set
   */
  set(values: Record<string, any>): void;

  set<T>(
    keyOrValues: string | string[] | Record<string, any>,
    value?: T,
  ): void {
    if (typeof keyOrValues === "string") {
      keyOrValues = keyOrValues.split(".");
    }
    if (Array.isArray(keyOrValues)) {
      const key = keyOrValues as string[];

      const resolved = resolvePath(this.values, key, true);
      if (resolved) {
        resolved.obj[resolved.key] = value;
      } else {
        throw new Error(`Invalid key ${key}`);
      }

      // Re-apply nested schema defaults so partial object writes don't wipe
      // out defaults for nested properties the user didn't specify.
      const schema = this.getSchemaAtPath(key);
      if (schema) {
        this.applySchemaDefaults(key, schema);
      }

      // Find and validate only the relevant schema
      this.validatePath(key);
    } else {
      // Handle object form
      for (const [key, val] of Object.entries(keyOrValues)) {
        this.set(key, val);
      }
    }
  }

  insert<T>(key: string | string[], value?: T): void {
    if (typeof key === "string") {
      key = key.split(".");
    }
    const resolved = resolvePath(this.values, key, true);
    if (resolved) {
      if (!Array.isArray(resolved.obj[resolved.key])) {
        resolved.obj[resolved.key] = [];
      }
      resolved.obj[resolved.key].push(value);
    } else {
      throw new Error(`Invalid key ${key}`);
    }

    // Find and validate only the relevant schema after the fact...
    this.validatePath(key);
  }

  /**
   * Checks if a path exists in the config
   * @param path The path to check, supports dot notation (e.g. "foo.bar.baz")
   * @returns True if the path exists, false otherwise
   */
  has(path: string | string[]): boolean {
    if (typeof path === "string") {
      path = path.split(".");
    }
    const resolved = resolvePath(this.values, path);
    if (!resolved) {
      return false;
    }

    return resolved.key in resolved.obj;
  }

  /**
   * Lists all configuration keys in the config
   * @returns An array of keys
   */
  keys(): string[] {
    return Object.keys(this.values);
  }

  /**
   * Validates a specific path against its schema
   */
  private validatePath(path: string[]): void {
    // Find the deepest schema that applies to this path
    for (let i = path.length; i > 0; i--) {
      const schemaPath = path.slice(0, i);
      const schema = this.getSchemaAtPath(schemaPath);
      if (schema) {
        const valueAtPath = this.get(schemaPath, undefined);
        if (valueAtPath !== undefined) {
          const validator = new Validator(schema, "7");
          const result = validator.validate(stripFunctions(valueAtPath));
          if (!result.valid) {
            const errorText = cfwFormatErrors(result.errors);
            throw new Error(
              `Validation error for ${schemaPath.join(".")}:> ${errorText}`,
            );
          }
        }
        break; // Only validate the most specific schema
      }
    }
  }

  /**
   * Gets the schema at a specific path
   */
  private getSchemaAtPath(path: string[]): any | null {
    let current = this.schemas;
    for (const part of path) {
      if (!current.properties || !current.properties[part]) {
        return null;
      }
      current = current.properties[part];
    }
    return current.type ? current : null;
  }
}

/**
 * Resolves a configuration path to the containing object and final key
 * @param path The path to resolve (e.g. ["foo", "bar", "baz"])
 * @param create Whether to create objects along the path if they don't exist
 * @returns The containing object and the final key, or null if the path cannot be resolved
 */
function resolvePath(
  inObject: Record<string, any>,
  path: string[],
  create = false,
): { obj: any; key: string } | null {
  // To avoid side effects, let's clone the path bits
  path = [...path];

  const lastKey = path.pop()!;
  let current = inObject;

  for (const part of path) {
    if (current[part] === undefined) {
      if (create) {
        current[part] = {};
      } else {
        return null;
      }
    } else if (typeof current[part] !== "object" || current[part] === null) {
      if (create) {
        // Convert primitive to object if we're creating the path
        current[part] = {};
      } else {
        return null;
      }
    }

    current = current[part];
  }

  return { obj: current, key: lastKey };
}
