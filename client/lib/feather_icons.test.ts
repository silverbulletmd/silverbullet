import { expect, test } from "vitest";
import {
  featherIconNames,
  kebabToPascal,
  resolveFeatherIcons,
} from "./feather_icons.ts";

test("kebabToPascal keeps numbered icon names resolvable", () => {
  expect(kebabToPascal("trash-2")).toBe("Trash2");
  expect(kebabToPascal("edit-3")).toBe("Edit3");
  expect(kebabToPascal("corner-up-left")).toBe("CornerUpLeft");
  expect(kebabToPascal("zoom-in")).toBe("ZoomIn");
  expect(kebabToPascal("home")).toBe("Home");
  expect(kebabToPascal("")).toBe("");
});

test("resolveFeatherIcons returns standalone SVG without requiring a DOM", () => {
  const icons = resolveFeatherIcons(["user", "not-a-real-icon"]);

  expect(icons.user).toMatch(/^<svg[^>]*>/);
  expect(icons.user).toContain("<path");
  expect(icons["not-a-real-icon"]).toBeUndefined();
});

test("lists Feather icons by their kebab-case names", () => {
  const names = featherIconNames();
  expect(names).toContain("file-text");
  expect(names).toContain("bar-chart-2");
  expect(names).toContain("tag");
  expect(names.every((n) => /^[a-z0-9-]+$/.test(n))).toBe(true);
  for (const n of names.slice(0, 50))
    expect(kebabToPascal(n)).toMatch(/^[A-Z]/);
});
