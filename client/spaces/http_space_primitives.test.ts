import { afterEach, describe, expect, test, vi } from "vitest";
import {
  HttpSpacePrimitives,
  parseReconcileResponse,
  PermissionDeniedError,
  ReconcileIneligibleError,
} from "./http_space_primitives.ts";

const encode = (s: string) => new TextEncoder().encode(s);

describe("parseReconcileResponse", () => {
  test("returns null for 404 (server does not support reconciliation)", () => {
    expect(parseReconcileResponse(404, undefined)).toBeNull();
  });

  test("returns null for 405 (method not supported)", () => {
    expect(parseReconcileResponse(405, undefined)).toBeNull();
  });

  test("throws ReconcileIneligibleError for 409", () => {
    expect(() => parseReconcileResponse(409, undefined)).toThrow(
      ReconcileIneligibleError,
    );
  });

  test("throws ReconcileIneligibleError for 413", () => {
    expect(() => parseReconcileResponse(413, undefined)).toThrow(
      ReconcileIneligibleError,
    );
  });

  test("throws a plain Error for other non-OK statuses", () => {
    expect(() => parseReconcileResponse(500, undefined)).toThrow(Error);
    expect(() => parseReconcileResponse(500, undefined)).not.toThrow(
      ReconcileIneligibleError,
    );
  });

  test("parses an applied response on 200", () => {
    const body = {
      status: "applied",
      revision: {
        algorithm: "merge3",
        hash: "abc123",
        size: 42,
        lastModified: 1000,
      },
      text: "merged content",
    };
    expect(parseReconcileResponse(200, body)).toEqual(body);
  });

  test("parses a merged response on 200", () => {
    const body = {
      status: "merged",
      revision: {
        algorithm: "merge3",
        hash: "def456",
        size: 10,
        lastModified: 2000,
      },
      text: "merged text",
    };
    expect(parseReconcileResponse(200, body)).toEqual(body);
  });

  test("parses a conflicted response on 200", () => {
    const body = {
      status: "conflicted",
      revision: {
        algorithm: "merge3",
        hash: "ghi789",
        size: 20,
        lastModified: 3000,
      },
      text: "<<<<<<< conflict >>>>>>>",
    };
    expect(parseReconcileResponse(200, body)).toEqual(body);
  });

  test("parses a retry response on 200 (no text field)", () => {
    const body = {
      status: "retry",
      revision: {
        algorithm: "merge3",
        hash: "jkl012",
        size: 5,
        lastModified: 4000,
      },
    };
    expect(parseReconcileResponse(200, body)).toEqual(body);
  });
});

describe("HttpSpacePrimitives client identity headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("[]", {
          status: 200,
          headers: {
            "X-Last-Modified": "1",
            "X-Created": "1",
            "Content-Type": "text/markdown",
            "X-Permission": "rw",
          },
        });
      }),
    );
    return calls;
  }

  function space(clientId?: string, source?: string) {
    return new HttpSpacePrimitives(
      "http://x/.fs",
      "",
      () => {},
      undefined,
      clientId,
      source,
    );
  }

  test("writeFileConditional sends X-Client-Id and X-Source when configured", async () => {
    const calls = stubFetch();
    await space("client-abc", "editor").writeFileConditional(
      "a.md",
      new Uint8Array([1]),
    );
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("X-Client-Id")).toBe("client-abc");
    expect(headers.get("X-Source")).toBe("editor");
  });

  test("deleteFileConditional sends X-Client-Id and X-Source when configured", async () => {
    const calls = stubFetch();
    await space("client-abc", "sync").deleteFileConditional("a.md");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("X-Client-Id")).toBe("client-abc");
    expect(headers.get("X-Source")).toBe("sync");
  });

  test("reconcile sends X-Client-Id and X-Source when configured", async () => {
    const calls = stubFetch();
    await space("client-abc", "sync").reconcile("a.md", {
      baseHash: "aa",
      baseText: "base",
      proposedHash: "cc",
      proposedText: "proposed",
    });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("X-Client-Id")).toBe("client-abc");
    expect(headers.get("X-Source")).toBe("sync");
  });

  test("headers are omitted when clientId/source are not configured", async () => {
    const calls = stubFetch();
    await space().writeFileConditional("a.md", new Uint8Array([1]));
    const headers = new Headers(calls[0].init.headers);
    expect(headers.has("X-Client-Id")).toBe(false);
    expect(headers.has("X-Source")).toBe(false);
  });

  test("GET requests never carry X-Client-Id/X-Source even when configured", async () => {
    const calls = stubFetch();
    await space("client-abc", "sync").fetchFileList();
    const headers = new Headers(calls[0].init.headers);
    expect(headers.has("X-Client-Id")).toBe(false);
    expect(headers.has("X-Source")).toBe(false);
  });
});

function makePrimitives({
  fetch,
  authErrorCallback,
}: {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  authErrorCallback: (message: string, action?: string) => void;
}) {
  vi.stubGlobal("fetch", fetch);
  return new HttpSpacePrimitives("http://x/.fs", "", authErrorCallback);
}

describe("permission errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a 403 throws without triggering the auth callback", async () => {
    const authErrors: string[] = [];
    const primitives = makePrimitives({
      fetch: async () => new Response("nope", { status: 403 }),
      authErrorCallback: (message: string) => authErrors.push(message),
    });
    await expect(
      primitives.writeFile("index.md", encode("hi")),
    ).rejects.toThrow(PermissionDeniedError);
    expect(authErrors).toEqual([]);
  });

  test("a 401 on a write throws without triggering the auth callback", async () => {
    // An anonymous visitor on an `access: "read"` space gets 401+Location for
    // a refused write. Signing in is not the remedy for a write that was never
    // going to be allowed, and treating it as an auth error throws the visitor
    // to the login page mid-session.
    const authErrors: string[] = [];
    const primitives = makePrimitives({
      fetch: async () =>
        new Response("nope", { status: 401, headers: { location: "/.auth" } }),
      authErrorCallback: (message: string) => authErrors.push(message),
    });
    await expect(
      primitives.writeFile("index.md", encode("hi")),
    ).rejects.toThrow(PermissionDeniedError);
    expect(authErrors).toEqual([]);
  });

  test("a 401 without a Location header asks for a reload, not a navigation", async () => {
    const calls: (string | undefined)[] = [];
    const primitives = makePrimitives({
      fetch: async () => new Response("nope", { status: 401 }),
      authErrorCallback: (_m: string, action?: string) => calls.push(action),
    });
    await expect(primitives.readFile("index.md")).rejects.toThrow();
    expect(calls).toEqual(["reload"]);
  });

  test("a 401 with a Location header still redirects", async () => {
    const calls: (string | undefined)[] = [];
    const primitives = makePrimitives({
      fetch: async () =>
        new Response("nope", { status: 401, headers: { location: "/.auth" } }),
      authErrorCallback: (_m: string, action?: string) => calls.push(action),
    });
    await expect(primitives.readFile("index.md")).rejects.toThrow();
    expect(calls).toEqual(["/.auth"]);
  });
});
