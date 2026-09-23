import { afterEach, expect, test, vi } from "vitest";
import { mediaTestDocument } from "../test_media_dom.ts";
import { createMediaElement } from "./inline.ts";

afterEach(() => vi.unstubAllGlobals());

test("wiki images containing colons use the local filesystem", () => {
  vi.stubGlobal("document", mediaTestDocument());
  const element = createMediaElement({
    url: "meeting:diagram.png",
    alias: "Diagram",
    linktype: "wikilink",
  });
  expect(element?.getAttribute("src")).toBe(".fs/meeting%3Adiagram.png");
});
