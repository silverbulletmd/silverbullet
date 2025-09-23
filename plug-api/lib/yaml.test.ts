import { assertEquals, assertExists } from "@std/assert";
import { applyPatches, type SetKeyPatch } from "./yaml.ts";

Deno.test("YAML patching - basic operations and value types", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
description: A sample package
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "version", value: "1.1.0" },
    { op: "set-key", path: "description", value: "Updated description" },
    { op: "set-key", path: "empty", value: "" },
    { op: "set-key", path: "special", value: "value:with:colons" },
    { op: "set-key", path: "null", value: null },
    { op: "set-key", path: "emptyList", value: [] },
    { op: "set-key", path: "emptyObject", value: {} },
  ];

  const result = applyPatches(initialYaml, patches);

  assertExists(result);
  // Basic scalar updates
  assertEquals(result.includes("version: 1.1.0"), true);
  assertEquals(result.includes("description: Updated description"), true);
  assertEquals(result.includes("name: my-package"), true);

  // Special values and characters
  assertEquals(result.includes('empty: ""'), true);
  assertEquals(result.includes('special: "value:with:colons"'), true);
  assertEquals(result.includes("null: null"), true);

  // Empty collections
  assertEquals(result.includes("emptyList: []"), true);
  assertEquals(result.includes("emptyObject: {}"), true);
});

Deno.test("YAML patching - collections and nested structures", () => {
  const initialYaml = `
name: my-package
tags:
  - node
  - typescript
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "tags", value: ["deno", "typescript", "yaml"] },
    { op: "set-key", path: "dependencies", value: ["std", "testing"] },
    {
      op: "set-key",
      path: "config",
      value: {
        port: 3000,
        host: "localhost",
        settings: {
          debug: true,
          timeout: 5000,
        },
      },
    },
  ];

  const result = applyPatches(initialYaml, patches);

  assertExists(result);
  // Array values
  assertEquals(result.includes("tags:"), true);
  assertEquals(result.includes("- deno"), true);
  assertEquals(result.includes("- typescript"), true);
  assertEquals(result.includes("- yaml"), true);
  assertEquals(result.includes("dependencies:"), true);
  assertEquals(result.includes("- std"), true);
  assertEquals(result.includes("- testing"), true);

  // Nested object values
  assertEquals(result.includes("config:"), true);
  assertEquals(result.includes("  port: 3000"), true);
  assertEquals(result.includes("  host: localhost"), true);
  assertEquals(result.includes("    debug: true"), true);
  assertEquals(result.includes("    timeout: 5000"), true);
});

Deno.test("YAML patching - comments and formatting preservation", () => {
  const initialYaml = `
# Main package configuration
name: my-package  # The package name
version: 1.0.0    # Current version
description: A sample package

# Additional metadata
author: John Doe  # Package maintainer
license: MIT      # License type

`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "version", value: "2.0.0" },
    { op: "set-key", path: "description", value: "An updated package" },
    { op: "set-key", path: "newProp", value: "new value" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify all comments are preserved
  assertEquals(result.includes("# Main package configuration"), true);
  assertEquals(result.includes("# The package name"), true);
  assertEquals(result.includes("# Current version"), true);
  assertEquals(result.includes("# Additional metadata"), true);
  assertEquals(result.includes("# Package maintainer"), true);
  assertEquals(result.includes("# License type"), true);

  // Verify content is correct and in order
  assertEquals(result.includes("version: 2.0.0"), true);
  assertEquals(result.includes("description: An updated package"), true);
  assertEquals(result.includes("newProp: new value"), true);

  // Verify trailing newlines are preserved
  assertEquals(result.endsWith("\n"), true);
  const lines = result.split("\n");
  assertEquals(lines[lines.length - 1], "");
});

Deno.test("YAML patching - edge cases", () => {
  // Test empty input
  const emptyResult = applyPatches("", [
    { op: "set-key", path: "name", value: "new-package" },
  ]);
  assertEquals(emptyResult.trim(), "name: new-package");

  // Test single line with trailing newline
  const singleLineResult = applyPatches("key: value\n", [
    { op: "set-key", path: "key", value: "new value" },
  ]);
  assertEquals(singleLineResult, "key: new value\n");

  // Test multiple trailing newlines
  const multiNewlineResult = applyPatches("key: value\n\n\n", [
    { op: "set-key", path: "key", value: "new value" },
  ]);
  assertEquals(multiNewlineResult, "key: new value\n");
});
