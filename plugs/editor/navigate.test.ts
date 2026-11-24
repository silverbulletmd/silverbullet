import { beforeEach, expect, test, vi } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";

const editor = {
  getText: vi.fn(),
  getCursor: vi.fn(async () => 2),
  getCurrentPage: vi.fn(async () => "Notes/Source"),
  openUrl: vi.fn(),
  navigate: vi.fn(),
  flashNotification: vi.fn(),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  editor,
  markdown: { parseMarkdown },
  config: {},
  space: {},
}));

const { clickNavigate, linkNavigate } = await import("./navigate.ts");

beforeEach(() => vi.clearAllMocks());

test.each([
  "https://example.com/path?q=a%20b#heading",
  "zotero://select/library/items/ABC123",
  "MAILTO:reader@example.com",
  "custom+notes.v2:open-item",
])(
  "click and keyboard navigation open <%s> as an external URL",
  async (url) => {
    for (const destination of [url, `<${url}>`]) {
      editor.getText.mockResolvedValue(`[link](${destination})`);
      await clickNavigate({
        page: "Notes/Source",
        pos: 2,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
      await linkNavigate();
    }

    expect(editor.openUrl.mock.calls).toEqual([[url], [url], [url], [url]]);
    expect(editor.navigate).not.toHaveBeenCalled();
    expect(editor.flashNotification).not.toHaveBeenCalled();
  },
);

test("brackets preserve local heading navigation", async () => {
  editor.getText.mockResolvedValue("[heading](#Heading)");
  await linkNavigate();
  const [ordinary] = editor.navigate.mock.calls;
  expect(ordinary).toBeDefined();
  editor.getText.mockResolvedValue("[heading](<#Heading>)");
  await linkNavigate();
  expect(editor.navigate.mock.calls).toEqual([ordinary, ordinary]);
  expect(editor.openUrl).not.toHaveBeenCalled();
});

test.each(["Local%20note", "<Local note>", "<../Local note>"])(
  "local destination %s stays relative to the current page",
  async (destination) => {
    editor.getText.mockResolvedValue(`[link](${destination})`);
    await linkNavigate();
    expect(editor.navigate).toHaveBeenCalledWith({
      path: destination.includes("../")
        ? "Local note.md"
        : "Notes/Local note.md",
    });
    expect(editor.openUrl).not.toHaveBeenCalled();
  },
);
