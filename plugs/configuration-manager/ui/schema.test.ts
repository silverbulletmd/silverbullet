import { describe, expect, test } from "vitest";
import { buildSchemaIndex } from "./schema.ts";

describe("buildSchemaIndex", () => {
  test("uses managed config overrides as initial field values", () => {
    const index = buildSchemaIndex({
      schemas: {
        type: "object",
        properties: {
          frontmatterFolding: {
            type: "object",
            properties: {
              foldByDefault: {
                type: "string",
                enum: ["never", "long", "always"],
                default: "long",
                ui: { category: "Editor", label: "Auto-fold frontmatter" },
              },
            },
          },
        },
      },
      values: {
        frontmatterFolding: {
          foldByDefault: "long",
        },
      },
      categories: {},
      commands: {},
      commandOverrides: {},
      configOverrides: {
        "frontmatterFolding.foldByDefault": "always",
      },
      isMac: false,
      initialTab: "configuration",
      libraries: {
        repositories: [],
        installed: [],
        installable: [],
        roguePlugs: [],
      },
    });

    expect(index.initialConfig["frontmatterFolding.foldByDefault"]).toBe(
      "always",
    );
  });
});
