import { expect, test } from "vitest";
import YAML from "js-yaml";
import { applyPatches, type YamlPatch } from "./yaml.ts";

test("YAML patching - basic operations and value types", () => {
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

  expect(result).toBeDefined();
  expect(result.includes("version: 1.1.0")).toEqual(true);
  expect(result.includes("description: Updated description")).toEqual(true);
  expect(result.includes("name: my-package")).toEqual(true);

  expect(result.includes('empty: ""')).toEqual(true);
  expect(result.includes('special: "value:with:colons"')).toEqual(true);
  expect(result.includes("null: null")).toEqual(true);

  expect(result.includes("emptyList: []")).toEqual(true);
  expect(result.includes("emptyObject: {}")).toEqual(true);
});

test("YAML patching - collections and nested structures", () => {
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

  expect(result).toBeDefined();
  expect(result.includes("tags:")).toEqual(true);
  expect(result.includes("- deno")).toEqual(true);
  expect(result.includes("- typescript")).toEqual(true);
  expect(result.includes("- yaml")).toEqual(true);
  expect(result.includes("dependencies:")).toEqual(true);
  expect(result.includes("- std")).toEqual(true);
  expect(result.includes("- testing")).toEqual(true);

  expect(result.includes("config:")).toEqual(true);
  expect(result.includes("  port: 3000")).toEqual(true);
  expect(result.includes("  host: localhost")).toEqual(true);
  expect(result.includes("    debug: true")).toEqual(true);
  expect(result.includes("    timeout: 5000")).toEqual(true);
});

test("YAML patching - comments and formatting preservation", () => {
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

  expect(result.includes("# Main package configuration")).toEqual(true);
  expect(result.includes("# The package name")).toEqual(true);
  expect(result.includes("# Current version")).toEqual(true);
  expect(result.includes("# Additional metadata")).toEqual(true);
  expect(result.includes("# Package maintainer")).toEqual(true);
  expect(result.includes("# License type")).toEqual(true);

  expect(result.includes("version: 2.0.0")).toEqual(true);
  expect(result.includes("description: An updated package")).toEqual(true);
  expect(result.includes("newProp: new value")).toEqual(true);

  expect(result.endsWith("\n")).toEqual(true);
  const lines = result.split("\n");
  expect(lines[lines.length - 1]).toEqual("");
});

test("YAML patching - edge cases", () => {
  const emptyResult = applyPatches("", [
    { op: "set-key", path: "name", value: "new-package" },
  ]);
  expect(emptyResult.trim()).toEqual("name: new-package");

  const singleLineResult = applyPatches("key: value\n", [
    { op: "set-key", path: "key", value: "new value" },
  ]);
  expect(singleLineResult).toEqual("key: new value\n");

  const multiNewlineResult = applyPatches("key: value\n\n\n", [
    { op: "set-key", path: "key", value: "new value" },
  ]);
  expect(multiNewlineResult).toEqual("key: new value\n");
});

test("YAML patching - delete key basic operations", () => {
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

  expect(result).toBeDefined();
  expect(result.includes("version:")).toEqual(false);
  expect(result.includes("author:")).toEqual(false);

  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("description: A sample package")).toEqual(true);
  expect(result.includes("license: MIT")).toEqual(true);
});

test("YAML patching - delete key with comments", () => {
  const initialYaml = `
# Package configuration
name: my-package

# Version number
version: 1.0.0  # Current version

# Description
description: A sample package
author: John Doe  # Main author
`;

  const patches: YamlPatch[] = [{ op: "delete-key", path: "version" }];

  const result = applyPatches(initialYaml, patches);

  expect(result.includes("version:")).toEqual(false);
  expect(result.includes("# Version number")).toEqual(false);
  expect(result.includes("# Current version")).toEqual(false);

  expect(result.includes("# Package configuration")).toEqual(true);
  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("# Description")).toEqual(true);
  expect(result.includes("description: A sample package")).toEqual(true);
  expect(result.includes("author: John Doe")).toEqual(true);
  expect(result.includes("# Main author")).toEqual(true);
});

test("YAML patching - delete key with list values", () => {
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

  const patches: YamlPatch[] = [{ op: "delete-key", path: "tags" }];

  const result = applyPatches(initialYaml, patches);

  expect(result.includes("tags:")).toEqual(false);
  expect(result.includes("- node")).toEqual(false);
  expect(result.includes("- typescript")).toEqual(false);
  expect(result.includes("- yaml")).toEqual(false);

  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("dependencies:")).toEqual(true);
  expect(result.includes("- std")).toEqual(true);
  expect(result.includes("- testing")).toEqual(true);
  expect(result.includes("author: John Doe")).toEqual(true);
});

test("YAML patching - delete key with nested object values", () => {
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

  const patches: YamlPatch[] = [{ op: "delete-key", path: "config" }];

  const result = applyPatches(initialYaml, patches);

  expect(result.includes("config:")).toEqual(false);
  expect(result.includes("port: 3000")).toEqual(false);
  expect(result.includes("host: localhost")).toEqual(false);
  expect(result.includes("debug: true")).toEqual(false);
  expect(result.includes("timeout: 5000")).toEqual(false);

  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("author: John Doe")).toEqual(true);
});

test("YAML patching - delete non-existent key", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
`;

  const patches: YamlPatch[] = [{ op: "delete-key", path: "nonexistent" }];

  const result = applyPatches(initialYaml, patches);

  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("version: 1.0.0")).toEqual(true);
  expect(result).toEqual(initialYaml);
});

test("YAML patching - mixed set and delete operations", () => {
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

  expect(result.includes("author:")).toEqual(false);
  expect(result.includes("description:")).toEqual(false);

  expect(result.includes("version: 2.0.0")).toEqual(true);
  expect(result.includes("maintainer: Jane Smith")).toEqual(true);

  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("license: MIT")).toEqual(true);
});

test("YAML patching - delete all keys", () => {
  const initialYaml = `
name: my-package
version: 1.0.0
`;

  const patches: YamlPatch[] = [
    { op: "delete-key", path: "name" },
    { op: "delete-key", path: "version" },
  ];

  const result = applyPatches(initialYaml, patches);

  expect(result.trim()).toEqual("");
});

test("YAML patching - delete key preserves surrounding structure", () => {
  const initialYaml = `
# Header comment
name: my-package
version: 1.0.0
description: A sample package

# Footer comment
license: MIT
`;

  const patches: YamlPatch[] = [{ op: "delete-key", path: "version" }];

  const result = applyPatches(initialYaml, patches);

  expect(result.includes("# Header comment")).toEqual(true);
  expect(result.includes("name: my-package")).toEqual(true);
  expect(result.includes("description: A sample package")).toEqual(true);
  expect(result.includes("# Footer comment")).toEqual(true);
  expect(result.includes("license: MIT")).toEqual(true);

  expect(result.includes("version:")).toEqual(false);
});

test("set-key replaces a nested map value instead of keeping its old children", () => {
  const yaml =
    "pageDecoration:\n  icon: rocket\n  tree:\n    priority: 1\ntitle: x";
  const out = applyPatches(yaml, [
    { op: "set-key", path: "pageDecoration", value: { icon: "house" } },
  ]);
  expect(out).not.toContain("rocket");
  expect(out).not.toContain("priority");
  expect(out).toContain("icon: house");
  expect(out).toContain("title: x");
});

test("set-key replaces a block list value", () => {
  const yaml = "tags:\n- a\n- b\ntitle: x";
  const out = applyPatches(yaml, [{ op: "set-key", path: "tags", value: "c" }]);
  expect(out.trimEnd()).toBe("tags: c\ntitle: x");
});

test("set-key keeps a string's surrounding whitespace by quoting it", () => {
  const out = applyPatches("title: x", [
    { op: "set-key", path: "pageDecoration", value: { prefix: "🧑 " } },
  ]);
  expect(YAML.load(out)).toEqual({
    title: "x",
    pageDecoration: { prefix: "🧑 " },
  });
});

test("set-key replaces a nested block that contains blank lines", () => {
  const yaml = 'pageDecoration:\n  icon: home\n\n  prefix: "A "\ntitle: x';
  const out = applyPatches(yaml, [
    { op: "set-key", path: "pageDecoration", value: { icon: "house" } },
  ]);
  expect(YAML.load(out)).toEqual({
    pageDecoration: { icon: "house" },
    title: "x",
  });
});
