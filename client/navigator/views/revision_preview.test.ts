import { beforeEach, expect, test, vi } from "vitest";

const editor = {
  getCurrentPath: vi.fn<() => Promise<string>>(),
  navigate: vi.fn<(ref: unknown) => Promise<void>>(),
  setText: vi.fn<(text: string, isolateHistory?: boolean) => Promise<void>>(),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({ editor }));

const { closePreview, currentPreview, openPreview, parseDiff, restoreInto } =
  await import("./revision_preview.ts");

beforeEach(() => {
  vi.clearAllMocks();
  closePreview();
});

test("parseDiff classes each line and drops the git file header", () => {
  expect(
    parseDiff(
      "diff --git a/n.md b/n.md\n--- a/n.md\n@@ -1 +1 @@\n-a\n+b\n ctx\n",
    ),
  ).toEqual([
    { text: "@@ -1 +1 @@", cssClass: "sb-revision-diff-hunk" },
    { text: "-a", cssClass: "sb-revision-diff-del" },
    { text: "+b", cssClass: "sb-revision-diff-add" },
    { text: " ctx", cssClass: undefined },
  ]);
});

test("parseDiff leaves a hunkless diff whole and unclassed", () => {
  const raw = "diff --git a/old.md b/new.md\nrename from old.md\n";
  expect(parseDiff(raw)).toEqual([{ text: raw }]);
});

test("restoreInto writes straight to the buffer when the page is already open", async () => {
  editor.getCurrentPath.mockResolvedValue("note.md");

  await restoreInto("note.md", "restored");

  expect(editor.navigate).not.toHaveBeenCalled();
  // `true` isolates the history entry, making the restore a single undo.
  expect(editor.setText).toHaveBeenCalledWith("restored", true);
});

test("restoreInto opens the page first when the editor is elsewhere", async () => {
  editor.getCurrentPath
    .mockResolvedValueOnce("other.md")
    .mockResolvedValueOnce("note.md");

  await restoreInto("note.md", "restored");

  expect(editor.navigate).toHaveBeenCalledWith({ path: "note.md" });
  expect(editor.setText).toHaveBeenCalledWith("restored", true);
});

test("restoreInto refuses to write when the navigation didn't land", async () => {
  // The path is re-read rather than trusted: writing this text into whatever
  // buffer is actually open would destroy that page's content.
  editor.getCurrentPath.mockResolvedValue("other.md");

  await expect(restoreInto("note.md", "restored")).rejects.toThrow(
    "Cannot restore: could not open note.md.",
  );
  expect(editor.setText).not.toHaveBeenCalled();
});

test("each open supersedes the last, and carries a fresh token", () => {
  const base = {
    path: "note.md",
    header: "h",
    message: "m",
    canRestore: true,
    focus: true,
    dock: "rhs",
  };
  openPreview(base);
  const first = currentPreview()!;
  openPreview({ ...base, header: "h2" });
  const second = currentPreview()!;

  expect(second.header).toBe("h2");
  expect(second.token).not.toBe(first.token);

  closePreview();
  expect(currentPreview()).toBeUndefined();
});
