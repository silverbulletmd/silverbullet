import { expect, test } from "vitest";
import { Config } from "./config.ts";

test("Config - basic get/set/has/insert", () => {
  const config = new Config();

  config.set("testKey", "testValue");
  expect(config.get(["testKey"], null)).toEqual("testValue");

  config.insert("plugs", "plug1");
  config.insert("plugs", "plug1");
  expect(config.get("plugs", null)).toEqual(["plug1", "plug1"]);

  expect(config.get("nonExistentKey", "default")).toEqual("default");
  expect(config.has("testKey")).toBeTruthy();
  expect(config.has("nonExistentKey")).toBeFalsy();
});

test("Config - object-based and dot-notation setting", () => {
  const config = new Config({
    simple: "value",
    nested: { key: "nestedValue" },
  });

  expect(config.get("simple", null)).toEqual("value");
  expect(config.get("nested.key", null)).toEqual("nestedValue");

  config.set({ key1: "value1", "key2.nested": 123 });
  expect(config.get("key1", null)).toEqual("value1");
  expect(config.get("key2.nested", 0)).toEqual(123);

  config.set("user.profile.age", 30);
  expect(config.get("user.profile.age", 0)).toEqual(30);
  expect(config.has("user.profile.age")).toBeTruthy();
  expect(config.has("user.profile.nonExistent")).toBeFalsy();

  config.set(["user", "name"], "Pete");
  expect(config.get(["user", "name"], null)).toEqual("Pete");
  expect(config.get("user", {})).toEqual({
    name: "Pete",
    profile: { age: 30 },
  });
});

test("Config - edge cases", () => {
  const config = new Config();

  // Deep nesting from scratch
  config.set("a.b.c", "value");
  expect(config.get("a.b.c", null)).toEqual("value");

  // Overwriting a primitive with an object
  config.set("x", "primitive");
  config.set("x.y", "nested");
  expect(config.get("x.y", null)).toEqual("nested");
});

test("Config - schema validation", () => {
  const config = new Config();

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

  // Valid data
  config.set("user", { name: "John", age: 30, email: "john@example.com" });
  config.set("user.name", "John");

  // Missing required field
  expect(() => config.set("user", { name: "John" })).toThrow(
    "Validation error for user",
  );

  // Wrong type
  expect(() => config.set("user", { name: "John", age: "thirty" })).toThrow(
    "Validation error for user",
  );

  // Wrong type via path
  expect(() => config.set(["user", "name"], 22)).toThrow(
    "Validation error for user",
  );

  // Invalid format (email without @)
  expect(() =>
    config.set("user", { name: "John", age: 30, email: "not-an-email" }),
  ).toThrow("Validation error for user");

  // Value below minimum
  expect(() => config.set("user", { name: "John", age: -1 })).toThrow(
    "Validation error for user",
  );
});

test("Config - nested schema definitions", () => {
  const config = new Config();

  config.define("a.b.user", {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });

  config.define("system.config", {
    type: "object",
    properties: { version: { type: "string" }, enabled: { type: "boolean" } },
    required: ["version"],
  });

  config.set("a.b.user.name", "Hank");
  config.set("system.config.version", "1.0.0");
  config.set("system.config.enabled", true);

  expect(() => config.set("a.b.user.name", 22)).toThrow(
    "Validation error for a.b.user",
  );
  expect(() => config.set("system.config.enabled", "not-boolean")).toThrow(
    "Validation error for system.config",
  );
});

test("Config - define() rejects invalid schemas", () => {
  const config = new Config();

  expect(() => config.define("bad", { type: "invalid-type" })).toThrow(
    /^Invalid schema for key bad: /,
  );
  expect(() => config.define(["a", "b"], { type: "bogus" })).toThrow(
    /^Invalid schema for key a,b: /,
  );
});

test("Config - schema defaults", () => {
  const config = new Config();

  // Default applied when no value exists
  config.define("feature.enabled", { type: "boolean", default: true });
  expect(config.get("feature.enabled", null)).toEqual(true);

  // Existing value is not overwritten by default
  const config2 = new Config({ feature: { enabled: false } });
  config2.define("feature.enabled", { type: "boolean", default: true });
  expect(config2.get("feature.enabled", null)).toEqual(false);

  // Nested defaults from object properties
  const config3 = new Config();
  config3.define("widgets", {
    type: "object",
    properties: {
      toc: {
        type: "object",
        properties: {
          enabled: { type: "boolean", default: true },
          minHeaders: { type: "number", default: 3 },
        },
      },
    },
  });
  expect(config3.get("widgets.toc.enabled", null)).toEqual(true);
  expect(config3.get("widgets.toc.minHeaders", null)).toEqual(3);

  // Partial override: only unset leaves get defaults
  const config4 = new Config({ widgets: { toc: { minHeaders: 5 } } });
  config4.define("widgets", {
    type: "object",
    properties: {
      toc: {
        type: "object",
        properties: {
          enabled: { type: "boolean", default: true },
          minHeaders: { type: "number", default: 3 },
        },
      },
    },
  });
  expect(config4.get("widgets.toc.enabled", null)).toEqual(true);
  expect(config4.get("widgets.toc.minHeaders", null)).toEqual(5);

  // No default key means no value is set
  const config5 = new Config();
  config5.define("optional", { type: "string" });
  expect(config5.has("optional")).toBeFalsy();

  // Object/array defaults are deep-cloned so mutations don't leak
  const config6 = new Config();
  const defaultList = ["a", "b"];
  config6.define("items", {
    type: "array",
    default: defaultList,
  });
  const stored = config6.get<string[]>("items", []);
  stored.push("c");
  expect(defaultList).toEqual(["a", "b"]);
});

test("Config - partial object set preserves nested defaults", () => {
  const config = new Config();

  config.define("smartQuotes", {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true },
      double: {
        type: "object",
        properties: {
          left: { type: "string", default: "“" },
          right: { type: "string", default: "”" },
        },
      },
      single: {
        type: "object",
        properties: {
          left: { type: "string", default: "‘" },
          right: { type: "string", default: "’" },
        },
      },
    },
  });

  // Partial object set should not wipe out nested defaults
  config.set("smartQuotes", { enabled: true });
  expect(config.get("smartQuotes.double.left", null)).toEqual("“");
  expect(config.get("smartQuotes.double.right", null)).toEqual("”");
  expect(config.get("smartQuotes.single.left", null)).toEqual("‘");
  expect(config.get("smartQuotes.single.right", null)).toEqual("’");
  expect(config.get("smartQuotes.enabled", null)).toEqual(true);

  // User-specified values are preserved; missing siblings get defaults
  config.set("smartQuotes", { double: { left: "<<" } });
  expect(config.get("smartQuotes.double.left", null)).toEqual("<<");
  expect(config.get("smartQuotes.double.right", null)).toEqual("”");
  expect(config.get("smartQuotes.single.left", null)).toEqual("‘");
  expect(config.get("smartQuotes.enabled", null)).toEqual(true);
});

test("Config - custom format validation", () => {
  const config = new Config();

  // page-ref format
  config.define("link", {
    type: "object",
    properties: { ref: { type: "string", format: "page-ref" } },
  });

  config.set("link", { ref: "[[my page]]" });
  expect(() => config.set("link", { ref: "not a ref" })).toThrow(
    "Validation error for link",
  );
  expect(() => config.set("link", { ref: "[[no close" })).toThrow(
    "Validation error for link",
  );
});
