import { beforeEach, expect, test, vi } from "vitest";

const adminApi = vi.fn();
vi.mock("./api.ts", () => ({ adminApi }));
const { removeSpace, removeSpacePrompt } = await import("./remove_space.ts");

beforeEach(() => adminApi.mockReset());

test("removing keeps files unless deleteFiles is set", async () => {
  adminApi.mockResolvedValue({ status: "ok", warning: null });
  expect(await removeSpace("work", false)).toBeNull();
  expect(adminApi).toHaveBeenLastCalledWith("DELETE", "spaces/work");

  await removeSpace("work", true);
  expect(adminApi).toHaveBeenLastCalledWith(
    "DELETE",
    "spaces/work?deleteFiles=true",
  );
});

test("a folder the server could not delete comes back as a warning", async () => {
  adminApi.mockResolvedValue({ status: "ok", warning: "could not delete" });
  expect(await removeSpace("work", true)).toBe("could not delete");
});

test("the prompt says files are kept, or that deletion cannot be undone", () => {
  expect(removeSpacePrompt("Work", "spaces/work", false)).toContain(
    "Files on disk are kept",
  );
  const prompt = removeSpacePrompt("Work", "spaces/work", true);
  expect(prompt).toContain('"spaces/work"');
  expect(prompt).toContain("cannot be undone");
});
