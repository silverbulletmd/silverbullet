import { assert, assertEquals, assertThrows } from "@std/assert";
import { Config } from "./config.ts";

Deno.test("Config - basic functionality", () => {
  const config = new Config();

  // Test set and get
  config.set("testKey", "testValue");
  assertEquals(config.get(["testKey"], null), "testValue");

  // Test default value
  assertEquals(config.get("nonExistentKey", "default"), "default");

  // Test has
  assert(config.has("testKey"));
  assert(!config.has("nonExistentKey"));
});

Deno.test("Config - object-based setting", () => {
  const config = new Config();

  // Test setting multiple values at once
  config.set({
    key1: "value1",
    key2: "value2",
    key3: 123,
  });

  assertEquals(config.get("key1", null), "value1");
  assertEquals(config.get("key2", null), "value2");
  assertEquals(config.get("key3", 0), 123);
});

Deno.test("Config - paths", () => {
  const config = new Config();

  // Test setting with dot notation
  config.set("user.name", "John");
  config.set("user.profile.age", 30);

  // Test getting with dot notation
  assertEquals(config.get("user.name", null), "John");
  assertEquals(config.get("user.profile.age", 0), 30);

  config.set(["user", "name"], "Pete");
  config.set(["user", "profile", "age"], 20);
  assertEquals(config.get(["user", "name"], null), "Pete");
  assertEquals(config.get(["user", "profile", "age"], 0), 20);

  // Test has with dot notation
  assert(config.has("user.name"));
  assert(config.has("user.profile"));
  assert(config.has("user.profile.age"));
  assert(!config.has("user.profile.nonExistent"));

  // Test with path notation
  assert(config.has(["user", "name"]));
  assert(config.has(["user", "profile", "age"]));

  // Test getting the entire object
  assertEquals(config.get("user", {}), {
    name: "Pete",
    profile: {
      age: 20,
    },
  });
});

Deno.test("Config - edge cases", () => {
  const config = new Config();

  // Test setting a value on a non-existent path
  config.set("a.b.c", "value");
  assertEquals(config.get("a.b.c", null), "value");

  // Test overwriting a primitive with an object
  config.set("x", "primitive");
  assertEquals(config.get("x", null), "primitive");

  config.set("x.y", "nested");
  assertEquals(config.get("x.y", null), "nested");

  // Test setting a value on a path where part of the path is a primitive
  config.set("p", "primitive");
  config.set("p.q.r", "nested");
  assertEquals(config.get("p.q.r", null), "nested");

  // Test deep nesting
  config.set("deep.nesting.test.value", 42);
  assertEquals(config.get("deep.nesting.test.value", 0), 42);

  // Test with empty string key
  config.set("", "empty");
  assertEquals(config.get("", null), "empty");

  // Test with special characters in key
  config.set("special!@#", "chars");
  assertEquals(config.get("special!@#", null), "chars");
});

Deno.test("Config - object setting with dot notation in keys", () => {
  const config = new Config();

  // Test setting an object with dot notation in keys
  config.set({
    "user.name": "John",
    "user.profile.age": 30,
  });

  assertEquals(config.get("user.name", null), "John");
  assertEquals(config.get("user.profile.age", 0), 30);
});

Deno.test("Config - constructor with initial values", () => {
  const config = new Config({
    simple: "value",
    nested: {
      key: "nestedValue",
    },
  });

  assertEquals(config.get("simple", null), "value");
  assertEquals(config.get("nested.key", null), "nestedValue");
});

Deno.test("Config - schema validation", () => {
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
  assertThrows(
    () => {
      config.set("user", {
        name: "John",
      });
    },
    Error,
    "Validation error for user",
  );

  // Wrong type should throw
  assertThrows(
    () => {
      config.set("user", {
        name: "John",
        age: "thirty", // Should be a number
      });
    },
    Error,
    "Validation error for user",
  );

  // Wrong type should throw with path
  assertThrows(
    () => {
      config.set(["user", "name"], 22);
    },
    Error,
    "Validation error for user",
  );

  // Invalid format should throw
  assertThrows(
    () => {
      config.set("user", {
        name: "John",
        age: 30,
        email: "not-an-email",
      });
    },
    Error,
    "Validation error for user",
  );

  // Value below minimum should throw
  assertThrows(
    () => {
      config.set("user", {
        name: "John",
        age: -1, // Should be >= 0
      });
    },
    Error,
    "Validation error for user",
  );
});

Deno.test("Config - invalid schema definition", () => {
  const config = new Config();

  // Invalid schema should throw when defined
  assertThrows(
    () => {
      config.define("test", {
        type: "invalid-type", // Invalid type
      });
    },
    Error,
    "Invalid schema for key test",
  );
});
