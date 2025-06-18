import { Ajv } from "ajv";

export class Config {
  public schemas: Record<string, any> = {};
  private ajv = new Ajv();

  constructor(public values: Record<string, any> = {}) {
    // Add the same formats as in jsonschema.ts
    this.ajv.addFormat("email", {
      validate: (data: string) => {
        return data.includes("@");
      },
      async: false,
    });

    this.ajv.addFormat("page-ref", {
      validate: (data: string) => {
        return data.startsWith("[[") && data.endsWith("]]");
      },
      async: false,
    });
  }

  public clear() {
    this.schemas = {};
    this.values = {};
  }

  /**
   * Defines a JSON schema for a configuration key
   * @param key The configuration key to define a schema for
   * @param schema The JSON schema to validate against
   */
  define(key: string, schema: any): void {
    // Validate the schema itself first
    const valid = this.ajv.validateSchema(schema);
    if (!valid) {
      const errorText = this.ajv.errorsText(this.ajv.errors);
      throw new Error(`Invalid schema for key ${key}: ${errorText}`);
    }

    // Store the schema for the key
    this.schemas[key] = schema;
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
    const resolved = this.resolvePath(path);
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
      // Normalize
      keyOrValues = keyOrValues.split(".");
    }
    if (Array.isArray(keyOrValues)) {
      const key = keyOrValues as string[];

      const rootKey = key[0];

      const resolved = this.resolvePath(key, true);
      if (resolved) {
        resolved.obj[resolved.key] = value;
      } else {
        throw new Error(`Invalid key ${key}`);
      }

      // Check if there's a schema for this key
      if (this.schemas[rootKey]) {
        const validate = this.ajv.compile(this.schemas[rootKey]);
        // Validate against the new injected value
        if (!validate(this.values[rootKey])) {
          let errorText = this.ajv.errorsText(validate.errors);
          errorText = errorText.replaceAll("/", ".");
          errorText = errorText.replace(/^data[\.\s]/, "");
          throw new Error(
            `Validation error for ${key.join(".")}:> ${errorText}`,
          );
        }
      }
    } else {
      // Handle object form
      for (const [key, val] of Object.entries(keyOrValues)) {
        this.set(key, val);
      }
    }
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
    const resolved = this.resolvePath(path);
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
   * Resolves a configuration path to the containing object and final key
   * @param path The path to resolve (e.g. ["foo", "bar", "baz"])
   * @param create Whether to create objects along the path if they don't exist
   * @returns The containing object and the final key, or null if the path cannot be resolved
   */
  private resolvePath(
    path: string[],
    create = false,
  ): { obj: any; key: string } | null {
    // To avoid side effects, let's clone the path bits
    path = [...path];

    const lastKey = path.pop()!;
    let current = this.values;

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
}
