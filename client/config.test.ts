import { expect, test } from "vitest";
import { Config } from "./config.ts";

test("Config - basic functionality", () => {
  const config = new Config();

  // Test set and get
  config.set("testKey", "testValue");
  expect(config.get(["testKey"], null)).toEqual("testValue");

  // Test insert
  config.insert("plugs", "plug1");
  config.insert("plugs", "plug1");
  expect(config.get("plugs", null)).toEqual(["plug1", "plug1"]);

  // Test default value
  expect(config.get("nonExistentKey", "default")).toEqual("default");

  // Test has
  expect(config.has("testKey")).toBeTruthy();
  expect(!config.has("nonExistentKey")).toBeTruthy();
});

test("Config - object-based setting", () => {
  const config = new Config();

  // Test setting multiple values at once
  config.set({
    key1: "value1",
    key2: "value2",
    key3: 123,
  });

  expect(config.get("key1", null)).toEqual("value1");
  expect(config.get("key2", null)).toEqual("value2");
  expect(config.get("key3", 0)).toEqual(123);
});

test("Config - paths", () => {
  const config = new Config();

  // Test setting with dot notation
  config.set("user.name", "John");
  config.set("user.profile.age", 30);

  // Test getting with dot notation
  expect(config.get("user.name", null)).toEqual("John");
  expect(config.get("user.profile.age", 0)).toEqual(30);

  config.set(["user", "name"], "Pete");
  config.set(["user", "profile", "age"], 20);
  expect(config.get(["user", "name"], null)).toEqual("Pete");
  expect(config.get(["user", "profile", "age"], 0)).toEqual(20);

  // Test has with dot notation
  expect(config.has("user.name")).toBeTruthy();
  expect(config.has("user.profile")).toBeTruthy();
  expect(config.has("user.profile.age")).toBeTruthy();
  expect(!config.has("user.profile.nonExistent")).toBeTruthy();

  // Test with path notation
  expect(config.has(["user", "name"])).toBeTruthy();
  expect(config.has(["user", "profile", "age"])).toBeTruthy();

  // Test getting the entire object
  expect(config.get("user", {})).toEqual({
    name: "Pete",
    profile: {
      age: 20,
    },
  });
});

test("Config - edge cases", () => {
  const config = new Config();

  // Test setting a value on a non-existent path
  config.set("a.b.c", "value");
  expect(config.get("a.b.c", null)).toEqual("value");

  // Test overwriting a primitive with an object
  config.set("x", "primitive");
  expect(config.get("x", null)).toEqual("primitive");

  config.set("x.y", "nested");
  expect(config.get("x.y", null)).toEqual("nested");

  // Test setting a value on a path where part of the path is a primitive
  config.set("p", "primitive");
  config.set("p.q.r", "nested");
  expect(config.get("p.q.r", null)).toEqual("nested");

  // Test deep nesting
  config.set("deep.nesting.test.value", 42);
  expect(config.get("deep.nesting.test.value", 0)).toEqual(42);

  // Test with empty string key
  config.set("", "empty");
  expect(config.get("", null)).toEqual("empty");

  // Test with special characters in key
  config.set("special!@#", "chars");
  expect(config.get("special!@#", null)).toEqual("chars");
});

test("Config - object setting with dot notation in keys", () => {
  const config = new Config();

  // Test setting an object with dot notation in keys
  config.set({
    "user.name": "John",
    "user.profile.age": 30,
  });

  expect(config.get("user.name", null)).toEqual("John");
  expect(config.get("user.profile.age", 0)).toEqual(30);
});

test("Config - constructor with initial values", () => {
  const config = new Config({
    simple: "value",
    nested: {
      key: "nestedValue",
    },
  });

  expect(config.get("simple", null)).toEqual("value");
  expect(config.get("nested.key", null)).toEqual("nestedValue");
});

test("Config - schema validation", () => {
  const config = new Config();

  // Define a schema for a key
  const userSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number", minimum: 0 },
      email: { type: "string", format: "email" },
    },
    required: ["name", "age"],
  };

  config.define("user", userSchema);

  // Valid data should work
  config.set("user", {
    name: "John",
    age: 30,
    email: "john@example.com",
  });

  config.set("user.name", "John");

  // Missing required field should throw
  expect(() => {
    config.set("user", {
      name: "John",
    });
  }).toThrow("Validation error for user");

  // Wrong type should throw
  expect(() => {
    config.set("user", {
      name: "John",
      age: "thirty", // Should be a number
    });
  }).toThrow("Validation error for user");

  // Wrong type should throw with path
  expect(() => {
    config.set(["user", "name"], 22);
  }).toThrow("Validation error for user");

  // Invalid format should throw
  expect(() => {
    config.set("user", {
      name: "John",
      age: 30,
      email: "not-an-email",
    });
  }).toThrow("Validation error for user");

  // Value below minimum should throw
  expect(() => {
    config.set("user", {
      name: "John",
      age: -1, // Should be >= 0
    });
  }).toThrow("Validation error for user");

  // Check nested keys
  config.define("a.b.user", userSchema);

  console.log(config.schemas);

  config.set("a.b.user.name", "Hank");
  expect(() => {
    config.set("a.b.user.name", 22);
  }).toThrow("Validation error for a.b.user");
});

test("Config - nested schema definitions with arrays", () => {
  const config = new Config();

  // Define schema for nested path using array syntax
  const settingsSchema = {
    type: "object",
    properties: {
      theme: { type: "string" },
      maxItems: { type: "number", minimum: 1 },
    },
    required: ["theme"],
  };

  config.define(["app", "ui", "settings"], settingsSchema);

  // Valid nested setting should work
  config.set("app.ui.settings", {
    theme: "dark",
    maxItems: 10,
  });

  expect(config.get("app.ui.settings.theme", null)).toEqual("dark");
  expect(config.get("app.ui.settings.maxItems", 0)).toEqual(10);

  // Setting individual nested properties should work
  config.set("app.ui.settings.theme", "light");
  expect(config.get("app.ui.settings.theme", null)).toEqual("light");

  // Invalid type should throw
  expect(() => {
    config.set("app.ui.settings.theme", 123);
  }).toThrow("Validation error for app.ui.settings");

  // Invalid value should throw
  expect(() => {
    config.set("app.ui.settings.maxItems", -1);
  }).toThrow("Validation error for app.ui.settings");
});

test("Config - multiple nested schemas", () => {
  const config = new Config();

  // Define multiple schemas at different nesting levels
  const userSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name"],
  };

  const configSchema = {
    type: "object",
    properties: {
      version: { type: "string" },
      enabled: { type: "boolean" },
    },
    required: ["version"],
  };

  config.define("user", userSchema);
  config.define("system.config", configSchema);

  // Both schemas should work independently
  config.set("user.name", "Alice");
  config.set("system.config.version", "1.0.0");
  config.set("system.config.enabled", true);

  expect(config.get("user.name", null)).toEqual("Alice");
  expect(config.get("system.config.version", null)).toEqual("1.0.0");
  expect(config.get("system.config.enabled", false)).toEqual(true);

  // Validation should work for both
  expect(() => {
    config.set("user.name", 123);
  }).toThrow("Validation error for user");

  expect(() => {
    config.set("system.config.enabled", "not-boolean");
  }).toThrow("Validation error for system.config");
});

test("Config - invalid schema definition", () => {
  const config = new Config();

  // Invalid schema should throw when defined
  expect(() => {
    config.define("test", {
      type: "invalid-type", // Invalid type
    });
  }).toThrow("Invalid schema for key test");
});
