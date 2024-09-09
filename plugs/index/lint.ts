import {
  jsonschema,
  system,
  YAML,
} from "@silverbulletmd/silverbullet/syscalls";
import type { LintDiagnostic, QueryExpression } from "../../plug-api/types.ts";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { LintEvent } from "../../plug-api/types.ts";
import { queryObjects } from "./api.ts";
import type { AdhocAttributeObject } from "./attributes.ts";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import {
  cleanupJSON,
  deepObjectMerge,
} from "@silverbulletmd/silverbullet/lib/json";

export async function lintYAML({ tree }: LintEvent): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const frontmatter = await extractFrontmatter(tree);
  const tags = ["page", ...frontmatter.tags || []];
  const schemaConfig = await system.getSpaceConfig("schema", {});
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FrontMatterCode") {
      // Query all readOnly attributes for pages with this tag set
      const readOnlyAttributes = await queryObjects<AdhocAttributeObject>(
        "ah-attr",
        {
          filter: ["and", ["=", ["attr", "tagName"], [
            "array",
            tags.map((tag): QueryExpression => ["string", tag]),
          ]], [
            "=",
            ["attr", "readOnly"],
            ["boolean", true],
          ]],
          distinct: true,
          select: [{ name: "name" }],
        },
      );

      // Check if we have schema for this
      let schema = {
        type: "object",
        additionalProperties: true,
      };
      for (const tag of tags) {
        if (schemaConfig.tag[tag]) {
          schema = deepObjectMerge(schema, schemaConfig.tag[tag]);
        }
      }

      const lintResult = await lintYaml(
        renderToText(node),
        node.from!,
        readOnlyAttributes.map((a) => a.name),
        schema,
      );
      if (lintResult) {
        diagnostics.push(lintResult);
      }
      return true;
    }
    if (node.type === "FencedCode") {
      const codeInfo = findNodeOfType(node, "CodeInfo")!;
      if (!codeInfo) {
        return true;
      }
      const codeLang = codeInfo.children![0].text!;
      // All known YAML formats
      if (
        ["include", "embed", "yaml", "space-config"].includes(codeLang) ||
        codeLang.startsWith("#")
      ) {
        const codeText = findNodeOfType(node, "CodeText");
        if (!codeText) {
          return true;
        }
        const yamlCode = renderToText(codeText);
        let lintResult: LintDiagnostic | undefined;
        if (codeLang === "space-config") {
          // First validate that config schema itself is valid
          let schemaResult = await jsonschema.validateSchema(
            schemaConfig.config,
          );
          if (schemaResult) {
            lintResult = {
              from: codeText.from!,
              to: codeText.to!,
              severity: "error",
              message: "[CONFIG SCHEMA ERROR]: " + schemaResult,
            };
          }
          // Lint the actual YAML
          if (!lintResult) {
            // First do a regular YAML lint based on the schema
            lintResult = await lintYaml(
              yamlCode,
              codeText.from!,
              [],
              schemaConfig.config,
            );
          }
          // Then check the tag schemas
          if (!lintResult) {
            // Quickly parse YAML again
            let parsed = await YAML.parse(yamlCode);
            parsed = cleanupJSON(parsed);
            // If tag schemas are defined, validate them
            if (parsed?.schema?.tag) {
              for (
                let [tagName, tagSchema] of Object.entries(parsed.schema.tag)
              ) {
                tagSchema = deepObjectMerge({ type: "object" }, tagSchema);
                schemaResult = await jsonschema.validateSchema(tagSchema);
                if (schemaResult) {
                  lintResult = {
                    from: codeText.from!,
                    to: codeText.to!,
                    severity: "error",
                    message: `[TAG ${tagName} SCHEMA ERROR]: ${schemaResult}`,
                  };
                  break;
                }
              }
            }
          }
        } else {
          // Regular YAML lint
          lintResult = await lintYaml(
            yamlCode,
            codeText.from!,
            [],
          );
        }
        if (lintResult) {
          diagnostics.push(lintResult);
        }
        return true;
      }
    }
    return false;
  });
  return diagnostics;
}

const errorRegex = /\((\d+):(\d+)\)/;

async function lintYaml(
  yamlText: string,
  startPos: number,
  readOnlyKeys: string[] = [],
  schema?: any,
): Promise<LintDiagnostic | undefined> {
  try {
    let parsed = await YAML.parse(yamlText);
    parsed = cleanupJSON(parsed);
    for (const key of readOnlyKeys) {
      if (parsed[key]) {
        return {
          from: startPos,
          to: startPos + yamlText.length,
          severity: "error",
          message: `Cannot set read-only attribute "${key}"`,
        };
      }
    }
    if (schema) {
      // First validate the schema itself
      const schemaResult = await jsonschema.validateSchema(schema);
      if (schemaResult) {
        return {
          from: startPos,
          to: startPos + yamlText.length,
          severity: "error",
          message: "[SCHEMA ERROR]: " + schemaResult,
        };
      }
      // Then validate the object
      const result = await jsonschema.validateObject(schema, parsed);
      if (result) {
        return {
          from: startPos,
          to: startPos + yamlText.length,
          severity: "error",
          message: result,
        };
      }
    }
  } catch (e) {
    const errorMatch = errorRegex.exec(e.message);
    if (errorMatch) {
      console.log("YAML error", e.message);
      const line = parseInt(errorMatch[1], 10) - 1;
      const yamlLines = yamlText.split("\n");
      let pos = startPos;
      for (let i = 0; i < line; i++) {
        pos += yamlLines[i].length + 1;
      }
      const endPos = pos + yamlLines[line]?.length || pos;

      return {
        from: pos,
        to: endPos,
        severity: "error",
        message: e.message,
      };
    }
  }
}
