import { describe, expect, test } from "vitest";
import { libraryStatusLabel } from "./library_status.ts";

describe("libraryStatusLabel", () => {
  test("no check yet shows no label", () => {
    expect(libraryStatusLabel(undefined)).toBeUndefined();
  });

  test("up to date", () => {
    expect(libraryStatusLabel({ state: "upToDate" })).toEqual({
      label: "up to date",
      tone: "ok",
    });
  });

  test("remote changed is an update", () => {
    expect(libraryStatusLabel({ state: "remoteChanged" })).toEqual({
      label: "update available",
      tone: "update",
    });
  });

  test("differs is an update", () => {
    expect(libraryStatusLabel({ state: "differs" })).toEqual({
      label: "update available",
      tone: "update",
    });
  });

  test("both changed warns about local edits", () => {
    expect(libraryStatusLabel({ state: "bothChanged" })).toEqual({
      label: "update available, changed locally",
      tone: "warn",
    });
  });

  test("local change alone warns", () => {
    expect(libraryStatusLabel({ state: "localChanged" })).toEqual({
      label: "changed locally",
      tone: "warn",
    });
  });

  test("missing on remote is an error", () => {
    expect(libraryStatusLabel({ state: "missing" })).toEqual({
      label: "missing on remote",
      tone: "error",
    });
  });

  test("a failed check is an error with the message as title", () => {
    expect(
      libraryStatusLabel({ state: "error", error: "repo not found" }),
    ).toEqual({
      label: "check failed",
      tone: "error",
      title: "repo not found",
    });
  });
});
