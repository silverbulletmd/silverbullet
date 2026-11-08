import { expect, test } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";
import { CheckedSpacePrimitives } from "./checked_space_primitives.ts";

test("Editor sees protected metadata as read-only and can edit ordinary files", async () => {
  const store = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const data = new TextEncoder().encode("Original");
  for (const path of ["Library/Cards.md", "CONFIG.md", "Notebook.md"])
    await store.writeFile(path, data);
  const editor = new CheckedSpacePrimitives(store, false, false);
  expect(
    (await editor.fetchFileList()).map(({ name, perm }) => [name, perm]),
  ).toEqual([
    ["CONFIG.md", "ro"],
    ["Library/Cards.md", "ro"],
    ["Notebook.md", "rw"],
  ]);
  for (const path of ["Library/Cards.md", "CONFIG.md"]) {
    expect((await editor.readFile(path)).meta.perm).toBe("ro");
    expect((await editor.getFileMeta(path)).perm).toBe("ro");
    await expect(editor.writeFile(path, data)).rejects.toThrow("not writable");
    await expect(editor.deleteFile(path)).rejects.toThrow("not writable");
    expect((await store.getFileMeta(path)).perm).toBe("rw");
  }
  await editor.writeFile("Notebook.md", new TextEncoder().encode("Updated"));
  expect(
    new TextDecoder().decode((await store.readFile("Notebook.md")).data),
  ).toBe("Updated");
  await expect(editor.writeFile("Library/New.md", data)).rejects.toThrow(
    "not writable",
  );
});
