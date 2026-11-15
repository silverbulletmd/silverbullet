import { afterEach, expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { clickNavigate } from "./navigate.ts";

const originalSyscall = globalThis.syscall;
let calls: [string, any[]][];

function stubEditor(text: string) {
  globalThis.syscall = async (name: string, ...args: any[]) => {
    calls.push([name, args]);
    switch (name) {
      case "markdown.parseMarkdown":
        return parseMarkdown(args[0]);
      case "editor.getText":
        return text;
      case "editor.getCurrentPage":
        return "Notes";
    }
  };
}

async function clickAt(text: string, marker: string) {
  calls = [];
  stubEditor(text);
  await clickNavigate({
    page: "Notes",
    pos: text.indexOf(marker),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  });
  return calls.filter(([name]) =>
    ["editor.navigate", "editor.openUrl"].includes(name),
  );
}

afterEach(() => {
  globalThis.syscall = originalSyscall;
});

const nested = "[![Report|300](/preview.png)](/Report.pdf)";

test("a click on a link around an image opens the link target", async () => {
  const [[name, [ref]]] = await clickAt(nested, "](/Report");
  expect(name).toBe("editor.navigate");
  expect(ref.path).toBe("Report.pdf");
});

test("a click on the image inside a link opens the image", async () => {
  const [[name, [ref]]] = await clickAt(nested, "/preview");
  expect(name).toBe("editor.navigate");
  expect(ref.path).toBe("preview.png");
});

test("plain links and images open their url", async () => {
  expect((await clickAt("[text](Page.md)", "text"))[0][1][0].path).toBe(
    "Page.md",
  );
  expect((await clickAt("![alt|300](image.png)", "alt"))[0][1][0].path).toBe(
    "image.png",
  );
  const [[name, [url]]] = await clickAt("[home](https://example.com)", "home");
  expect(name).toBe("editor.openUrl");
  expect(url).toBe("https://example.com");
});
