import { readFileSync } from "node:fs";
import * as sass from "sass";
import { expect, test } from "vitest";

test("the accent background is limited to the admonition title", () => {
  const css = sass.compileString(
    readFileSync("client/styles/colors.scss", "utf-8"),
    { loadPaths: ["client/styles"], style: "expanded" },
  ).css;
  const admonitionRule = css.match(/\.sb-admonition \{[^}]*\}/)?.[0] ?? "";
  const titleRule = css.match(/\.sb-admonition-title \{[^}]*\}/)?.[0] ?? "";

  expect(admonitionRule).not.toMatch(/background-color:/);
  expect(titleRule).toMatch(/background-color:/);
});
