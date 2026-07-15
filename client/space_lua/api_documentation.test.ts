import { expect, test } from "vitest";
import { renderApiDocumentationMarkdown } from "./api_documentation.ts";

test("renders deterministic API documentation Markdown", () => {
  expect(
    renderApiDocumentationMarkdown(
      [
        {
          kind: "syscall",
          name: "demo.zeta",
          description: "Does the last thing.",
          deprecated: "Use demo.alpha instead.",
          see: "API/other",
        },
        {
          kind: "builtin",
          name: "demo.alpha",
          description: "Does the first thing.",
          parameters: [
            {
              name: "value",
              type: "string",
              description: "Value to process.",
            },
            { name: "options", type: "table", optional: true },
          ],
          returns: [{ type: "boolean", description: "Whether it worked." }],
          examples: [{ code: 'print(demo.alpha("hi"))' }],
          see: "API/demo",
        },
      ],
      "demo",
    ),
  ).toBe(`### \`demo.alpha\`

\`demo.alpha(value, options?)\`

Does the first thing.

**Parameters:**

- \`value\` (\`string\`) — Value to process.
- \`options?\` (\`table\`)

**Returns:**

- \`boolean\` — Whether it worked.

**Example:**

\`\`\`lua
print(demo.alpha("hi"))
\`\`\`

### \`demo.zeta\`

\`demo.zeta()\`

> **Deprecated:** Use demo.alpha instead.

Does the last thing.

**See:** [[API/other]]`);
});

test("renders an explicit empty target message", () => {
  expect(renderApiDocumentationMarkdown([], "missing")).toBe(
    "_No documented API functions found for `missing`._",
  );
});
