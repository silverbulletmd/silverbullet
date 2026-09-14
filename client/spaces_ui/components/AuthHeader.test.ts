import { h } from "preact";
import { render } from "preact-render-to-string";
import { afterEach, expect, test } from "vitest";
import { AuthHeader } from "./AuthHeader.tsx";

afterEach(() => {
  delete (globalThis as any).location;
});

test("the standalone header shows the brand without repeating the current host", () => {
  (globalThis as any).location = { host: "notes.example.test:3000" };

  const html = render(h(AuthHeader, { logo: "logo.png" }));

  expect(html).toContain("SilverBullet");
  expect(html).not.toContain("notes.example.test:3000");
  expect(html).not.toContain("sb-auth-host");
});
