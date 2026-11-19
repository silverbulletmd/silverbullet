import { expect, test } from "vitest";
import { createPayload } from "./new_space.ts";

const values = { name: "Notes", folder: "spaces/notes" };
const base = {
  choice: { type: "kit", id: "personal" } as const,
  gitMode: "copy" as const,
  gitUrl: "",
  hasNotes: false,
};

test("a kit payload carries the kit id only", () => {
  expect(createPayload(values, base)).toEqual({
    ...values,
    starter: { type: "kit", id: "personal" },
  });
});

test("a folder that already has notes gets no starter", () => {
  expect(createPayload(values, { ...base, hasNotes: true })).toEqual({
    ...values,
    starter: { type: "none" },
  });
});

test("git copy sends the URL; git sync sends none", () => {
  const git = { ...base, choice: { type: "git" } as const, gitUrl: "u" };
  expect(createPayload(values, git).starter).toEqual({
    type: "git",
    url: "u",
  });
  expect(createPayload(values, { ...git, gitMode: "sync" }).starter).toEqual({
    type: "none",
  });
});
