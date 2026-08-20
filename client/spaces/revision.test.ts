import { describe, expect, test } from "vitest";
import { etagForHash, hashFromEtag } from "./revision.ts";

describe("etagForHash", () => {
  test("formats a quoted sha256 tag", () => {
    expect(etagForHash("abc123")).toBe('"sha256:abc123"');
  });
});

describe("hashFromEtag", () => {
  test("roundtrips with etagForHash", () => {
    const etag = etagForHash("abc123");
    expect(hashFromEtag(etag)).toBe("abc123");
  });

  test("accepts a bare (unquoted) tag", () => {
    expect(hashFromEtag("sha256:ff00")).toBe("ff00");
  });

  test("accepts a quoted tag", () => {
    expect(hashFromEtag('"sha256:ff00"')).toBe("ff00");
  });

  test("rejects weak (W/) tags", () => {
    expect(hashFromEtag('W/"sha256:ff00"')).toBeUndefined();
  });

  test("rejects other hash algorithms", () => {
    expect(hashFromEtag('"md5:ff00"')).toBeUndefined();
  });

  test("rejects the wildcard *", () => {
    expect(hashFromEtag("*")).toBeUndefined();
  });

  test("lowercases the hex digest", () => {
    expect(hashFromEtag('"sha256:FF00AB"')).toBe("ff00ab");
  });

  test("returns undefined for null", () => {
    expect(hashFromEtag(null)).toBeUndefined();
  });
});
