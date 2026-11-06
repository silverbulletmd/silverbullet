import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import { beforeEach, expect, test, vi } from "vitest";

const editor = {
  getText: vi.fn<() => Promise<string>>(),
  getCurrentPage: vi.fn<() => Promise<string>>(),
  getCursor: vi.fn<() => Promise<number>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  navigate: vi.fn<(ref: unknown) => Promise<void>>(),
  flashNotification: vi.fn<(message: string, type?: string) => Promise<void>>(),
};

const markdown = {
  parseMarkdown: async (text: string) => {
    const { parseMarkdown } = await import(
      "../../client/markdown_parser/parser.ts"
    );
    return parseMarkdown(text);
  },
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  editor,
  markdown,
  space: {},
  config: {},
}));

const { clickNavigate, linkNavigate } = await import("./navigate.ts");

beforeEach(() => {
  vi.clearAllMocks();
  editor.getCurrentPage.mockResolvedValue("index");
  editor.openUrl.mockResolvedValue();
  editor.navigate.mockResolvedValue();
  editor.flashNotification.mockResolvedValue();
});

function click(text: string, pos: number): ClickEvent {
  editor.getText.mockResolvedValue(text);
  return {
    page: "index",
    pos,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

test("clicking an angle-bracket link opens the destination without the brackets", async () => {
  const https = "[title](<https://github.com/silverbulletmd/silverbullet>)";
  await clickNavigate(click(https, https.indexOf("title")));
  expect(editor.openUrl).toHaveBeenCalledWith(
    "https://github.com/silverbulletmd/silverbullet",
  );
  expect(editor.flashNotification).not.toHaveBeenCalled();
  expect(editor.navigate).not.toHaveBeenCalled();

  const zotero = "[cite](<zotero://select/library/items/ABC>)";
  await clickNavigate(click(zotero, zotero.indexOf("cite")));
  expect(editor.openUrl).toHaveBeenCalledWith(
    "zotero://select/library/items/ABC",
  );

  const titled = '[title](<https://example.com/a%20b> "title")';
  await clickNavigate(click(titled, titled.indexOf("title")));
  expect(editor.openUrl).toHaveBeenCalledWith("https://example.com/a%20b");

  const spaced = "[title](<https://example.com/a b>)";
  await clickNavigate(click(spaced, spaced.indexOf("https")));
  expect(editor.openUrl).toHaveBeenCalledWith("https://example.com/a b");
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

test("following an angle-bracket link under the cursor opens the destination", async () => {
  const text = "[title](<https://github.com/silverbulletmd/silverbullet>)";
  editor.getText.mockResolvedValue(text);
  editor.getCursor.mockResolvedValue(text.indexOf("https"));
  await linkNavigate();
  expect(editor.openUrl).toHaveBeenCalledWith(
    "https://github.com/silverbulletmd/silverbullet",
  );
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

test("plain links and autolinks still open their URL", async () => {
  const plain = "[title](https://github.com/silverbulletmd/silverbullet)";
  await clickNavigate(click(plain, plain.indexOf("title")));
  expect(editor.openUrl).toHaveBeenCalledWith(
    "https://github.com/silverbulletmd/silverbullet",
  );

  const auto = "<https://github.com/silverbulletmd/silverbullet>";
  await clickNavigate(click(auto, auto.indexOf("https")));
  expect(editor.openUrl).toHaveBeenCalledWith(
    "https://github.com/silverbulletmd/silverbullet",
  );
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

test("an angle-bracket page link still navigates inside the space", async () => {
  editor.getCurrentPage.mockResolvedValue("Folder/Current");
  const text = "[notes](<My Page>)";
  await clickNavigate(click(text, text.indexOf("notes")));
  expect(editor.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ path: "Folder/My Page.md" }),
  );
  expect(editor.openUrl).not.toHaveBeenCalled();
  expect(editor.flashNotification).not.toHaveBeenCalled();
});
