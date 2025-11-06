import { assertEquals, assertExists } from "@std/assert";
import { applyPatches, type YamlPatch } from "./yaml.ts";

Deno.test("YAML patching - basic operations and value types", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
description: A sample package
`;

  const patches: YamlPatch[] = [
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

  const patches: YamlPatch[] = [
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

  const patches: YamlPatch[] = [
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

Deno.test("YAML patching - delete key basic operations", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
description: A sample package
author: John Doe
license: MIT
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "version" },
    { op: "delete-key", path: "author" },
  ];

  const result = applyPatches(initialYaml, patches);

  assertExists(result);
  // Verify deleted keys are gone
  assertEquals(result.includes("version:"), false);
  assertEquals(result.includes("author:"), false);

  // Verify remaining keys are still present
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("description: A sample package"), true);
  assertEquals(result.includes("license: MIT"), true);
});

Deno.test("YAML patching - delete key with comments", () => {
  const initialYaml = `
# Package configuration
name: my-package

# Version number
version: 1.0.0  # Current version

# Description
description: A sample package
author: John Doe  # Main author
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "version" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify the key and its comments are removed
  assertEquals(result.includes("version:"), false);
  assertEquals(result.includes("# Version number"), false);
  assertEquals(result.includes("# Current version"), false);

  // Verify other content remains
  assertEquals(result.includes("# Package configuration"), true);
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("# Description"), true);
  assertEquals(result.includes("description: A sample package"), true);
  assertEquals(result.includes("author: John Doe"), true);
  assertEquals(result.includes("# Main author"), true);
});

Deno.test("YAML patching - delete key with list values", () => {
  const initialYaml = `
name: my-package
tags:
  - node
  - typescript
  - yaml
dependencies:
  - std
  - testing
author: John Doe
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "tags" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify the key and its list values are removed
  assertEquals(result.includes("tags:"), false);
  assertEquals(result.includes("- node"), false);
  assertEquals(result.includes("- typescript"), false);
  assertEquals(result.includes("- yaml"), false);

  // Verify other content remains
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("dependencies:"), true);
  assertEquals(result.includes("- std"), true);
  assertEquals(result.includes("- testing"), true);
  assertEquals(result.includes("author: John Doe"), true);
});

Deno.test("YAML patching - delete key with nested object values", () => {
  const initialYaml = `
name: my-package
config:
  port: 3000
  host: localhost
  settings:
    debug: true
    timeout: 5000
author: John Doe
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "config" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify the key and its nested content are removed
  assertEquals(result.includes("config:"), false);
  assertEquals(result.includes("port: 3000"), false);
  assertEquals(result.includes("host: localhost"), false);
  assertEquals(result.includes("debug: true"), false);
  assertEquals(result.includes("timeout: 5000"), false);

  // Verify other content remains
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("author: John Doe"), true);
});

Deno.test("YAML patching - delete non-existent key", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "nonexistent" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify nothing changes when deleting a non-existent key
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("version: 1.0.0"), true);
  assertEquals(result, initialYaml);
});

Deno.test("YAML patching - mixed set and delete operations", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
description: A sample package
author: John Doe
license: MIT
`;

  const patches: YamlPatch[] = [
    { op: "set-key", path: "version", value: "2.0.0" },
    { op: "delete-key", path: "author" },
    { op: "set-key", path: "maintainer", value: "Jane Smith" },
    { op: "delete-key", path: "description" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify deletions
  assertEquals(result.includes("author:"), false);
  assertEquals(result.includes("description:"), false);

  // Verify updates and additions
  assertEquals(result.includes("version: 2.0.0"), true);
  assertEquals(result.includes("maintainer: Jane Smith"), true);

  // Verify unchanged content
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("license: MIT"), true);
});

Deno.test("YAML patching - delete all keys", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "name" },
    { op: "delete-key", path: "version" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Result should be effectively empty (just newlines)
  assertEquals(result.trim(), "");
});

Deno.test("YAML patching - delete key preserves surrounding structure", () => {
  const initialYaml = `
# Header comment
name: my-package
version: 1.0.0
description: A sample package

# Footer comment
license: MIT
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "version" },
  ];

  const result = applyPatches(initialYaml, patches);

  // Verify structure is maintained
  assertEquals(result.includes("# Header comment"), true);
  assertEquals(result.includes("name: my-package"), true);
  assertEquals(result.includes("description: A sample package"), true);
  assertEquals(result.includes("# Footer comment"), true);
  assertEquals(result.includes("license: MIT"), true);

  // Verify deleted key is gone
  assertEquals(result.includes("version:"), false);
});
