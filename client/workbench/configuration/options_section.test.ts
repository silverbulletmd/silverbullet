import { expect, test } from "vitest";
import { controlFor } from "./options_section.tsx";

test.each([
  [{ type: "string", ui: { font: "editor" } }, "font"],
  [{ type: "string", ui: { font: "code" } }, "font"],
  [{ type: "number", ui: { fontSize: true } }, "fontSize"],
  [{ type: "string", ui: { theme: true } }, "theme"],
  [{ type: "string", ui: { color: true } }, "color"],
  [{ type: "boolean", ui: {} }, "boolean"],
  [{ type: "string", enum: ["a", "b"], ui: {} }, "enum"],
  [{ type: "string", ui: { inputType: "password" } }, "string"],
  [{ type: "number", ui: {} }, "number"],
  [{ type: "object", ui: {} }, undefined],
  [{ type: "array", ui: {} }, undefined],
])("%j gets the %s control", (schema, control) => {
  expect(controlFor(schema)).toBe(control);
});
