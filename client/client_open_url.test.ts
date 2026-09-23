import { afterEach, expect, test, vi } from "vitest";
import { Client } from "./client.ts";

vi.mock("./components/widget_sandbox_iframe.ts", () => ({}));

afterEach(() => vi.unstubAllGlobals());

test("URL activation permits application links but rejects executable URLs", () => {
  const open = vi.fn();
  const location = { href: "https://example.com/" };
  vi.stubGlobal("open", open);
  vi.stubGlobal("location", location);
  for (const url of [
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,x",
  ]) {
    Client.prototype.openUrl(url);
    Client.prototype.openUrl(url, true);
  }
  expect(open).not.toHaveBeenCalled();
  expect(location.href).toBe("https://example.com/");
  Client.prototype.openUrl("custom-notes:open-item");
  expect(open).toHaveBeenCalledWith("custom-notes:open-item", "_blank");
});
