import { expect, test } from "vitest";
import { languageNameForExtension, loadLanguageFor } from "./languages.ts";

test.each([
  ["rs", "rs"],
  ["js", "js"],
  ["tex", "tex"],
  ["latex", "latex"],
  ["yml", "yaml"],
  ["jsx", "jsx"],
  ["tsx", "tsx"],
  ["unknown-source", null],
  ["constructor", null],
])("maps extension %s to its registered language", (extension, expected) => {
  expect(languageNameForExtension(extension!)).toBe(expected);
});

test.each([
  "tex",
  "latex",
  "jsx",
  "tsx",
  "yml",
])("lazily loads %s using the shared registry", async (name) => {
  const language = await loadLanguageFor(name);
  expect(language).not.toBeNull();
  expect(await loadLanguageFor(name)).toBe(language);
});
