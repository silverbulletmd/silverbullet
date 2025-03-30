import { assertEquals, assertExists } from "@std/assert";
import { applyMinimalSetKeyPatches, SetKeyPatch } from "./yaml.ts";

Deno.test("YAML patching - basic scalar operations", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
description: A sample package
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "version", value: "1.1.0" },
    { op: "set-key", path: "description", value: "Updated description" },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.includes("version: 1.1.0"), true);
  assertEquals(result.includes("description: Updated description"), true);
  assertEquals(result.includes("name: my-package"), true);
});

Deno.test("YAML patching - adding new keys", () => {
  const initialYaml = `
name: my-package
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "version", value: "1.0.0" },
    { op: "set-key", path: "private", value: true },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.includes("version: 1.0.0"), true);
  assertEquals(result.includes("private: true"), true);
});

Deno.test("YAML patching - list operations", () => {
  const initialYaml = `
name: my-package
tags:
  - node
  - typescript
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "tags", value: ["deno", "typescript", "yaml"] },
    { op: "set-key", path: "dependencies", value: ["std", "testing"] },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.includes("tags:"), true);
  assertEquals(result.includes("- deno"), true);
  assertEquals(result.includes("- typescript"), true);
  assertEquals(result.includes("- yaml"), true);
  assertEquals(result.includes("dependencies:"), true);
  assertEquals(result.includes("- std"), true);
  assertEquals(result.includes("- testing"), true);
});

Deno.test("YAML patching - empty values and special characters", () => {
  const initialYaml = `
name: my-package
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "empty", value: "" },
    { op: "set-key", path: "special", value: "value:with:colons" },
    { op: "set-key", path: "null", value: null },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.includes('empty: ""'), true);
  assertEquals(result.includes('special: "value:with:colons"'), true);
  assertEquals(result.includes("null: null"), true);
});

Deno.test("YAML patching - empty input", () => {
  const initialYaml = "";
  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "name", value: "new-package" },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.trim(), "name: new-package");
});

Deno.test("YAML patching - nested object values", () => {
  const initialYaml = `
name: my-package
`;

  const patches: SetKeyPatch[] = [
    {
      op: "set-key",
      path: "config",
      value: {
        port: 3000,
        host: "localhost",
      },
    },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.includes("config:"), true);
  assertEquals(result.includes("  port: 3000"), true);
  assertEquals(result.includes("  host: localhost"), true);
});

Deno.test("YAML patching - empty lists and objects", () => {
  const initialYaml = `
name: my-package
`;

  const patches: SetKeyPatch[] = [
    { op: "set-key", path: "emptyList", value: [] },
    { op: "set-key", path: "emptyObject", value: {} },
  ];

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  assertExists(result);
  assertEquals(result.includes("emptyList: []"), true);
  assertEquals(result.includes("emptyObject: {}"), true);
});

Deno.test("YAML patching - preserves comments", () => {
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

  const result = applyMinimalSetKeyPatches(initialYaml, patches);

  // Verify all comments are preserved
  assertEquals(result.includes("# Main package configuration"), true);
  assertEquals(result.includes("# The package name"), true);
  assertEquals(result.includes("# Current version"), true);
  assertEquals(result.includes("# Additional metadata"), true);
  assertEquals(result.includes("# Package maintainer"), true);
  assertEquals(result.includes("# License type"), true);

  // Verify the content is also correct
  assertEquals(result.includes("version: 2.0.0"), true);
  assertEquals(result.includes("description: An updated package"), true);
  assertEquals(result.includes("newProp: new value"), true);
});
