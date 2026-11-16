import { describe, expect, it } from "vitest";
import { type UpdateCheckAnswer, updateNotice } from "./update_notice.ts";

const advisory = {
  id: "SB-1",
  fixedIn: "2.9.0",
  severity: "high",
  summary: "Bad thing",
  url: "https://example.com/a",
};
const update = {
  version: "2.9.0",
  url: "https://example.com/r",
  title: "2.9.0 released",
};
const none: UpdateCheckAnswer = { update: null, security: [] };

describe("updateNotice", () => {
  it("is null when there is nothing to say", () => {
    expect(updateNotice(none, null)).toBeNull();
  });
  it("lets security win over update", () => {
    expect(updateNotice({ update, security: [advisory] }, null)).toEqual({
      kind: "security",
      advisories: [advisory],
    });
  });
  it("shows an update", () => {
    expect(updateNotice({ ...none, update }, null)).toEqual({
      kind: "update",
      update,
    });
  });
  it("hides an update the admin dismissed, until a newer one", () => {
    expect(updateNotice({ ...none, update }, "2.9.0")).toBeNull();
    const newer = { ...update, version: "2.10.0" };
    expect(updateNotice({ ...none, update: newer }, "2.9.0")).toEqual({
      kind: "update",
      update: newer,
    });
  });
  it("never hides a security warning", () => {
    expect(
      updateNotice({ update, security: [advisory] }, "2.9.0"),
    ).toMatchObject({ kind: "security" });
  });
});
