import { expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import { spaceReadSyscalls } from "./space.ts";

async function activityUrl(...args: (number | undefined)[]): Promise<string> {
  const authenticatedFetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ commits: [1], topFiles: [] }), {
        status: 200,
      }),
  );
  const client = {
    httpSpacePrimitives: { url: "http://host/.fs", authenticatedFetch },
  } as unknown as Client;
  const syscall = spaceReadSyscalls(client)["space.getActivity"] as any;
  const result = await syscall.callback({}, ...args);
  expect(result).toEqual({ commits: [1], topFiles: [] });
  return authenticatedFetch.mock.calls[0][0];
}

test("space.getActivity builds the _activity URL with only the given params", async () => {
  expect(await activityUrl(10, undefined, 3)).toMatch(
    /\/\.revisions\/_activity\?since=10&top=3$/,
  );
  expect(await activityUrl()).toMatch(/\/\.revisions\/_activity$/);
});

function mergeSyscall(response: Response) {
  const authenticatedFetch = vi.fn(
    async (_url: string, _init: RequestInit) => response,
  );
  const client = {
    httpSpacePrimitives: { url: "http://x/sub/.fs", authenticatedFetch },
  } as unknown as Client;
  const syscall = spaceReadSyscalls(client)["space.mergeText"] as any;
  return {
    authenticatedFetch,
    merge: () => syscall.callback({}, "A\n", "B\n", "C\n"),
  };
}

test("space.mergeText posts the texts to /.merge", async () => {
  const { authenticatedFetch, merge } = mergeSyscall(
    Response.json({ status: "clean", text: "M\n" }),
  );
  expect(await merge()).toEqual({ status: "clean", text: "M\n" });
  const [url, init] = authenticatedFetch.mock.calls[0];
  expect(url).toBe("http://x/sub/.merge");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({
    base: "A\n",
    local: "B\n",
    remote: "C\n",
  });
});

test("space.mergeText returns nil for texts it can't merge", async () => {
  for (const status of [409, 413]) {
    const { merge } = mergeSyscall(new Response("no", { status }));
    expect(await merge(), String(status)).toBeNull();
  }
  const { merge } = mergeSyscall(new Response("bad", { status: 400 }));
  await expect(merge()).rejects.toThrow(/400/);
});

test("space.mergeText requires a server connection", async () => {
  const client = {} as unknown as Client;
  const syscall = spaceReadSyscalls(client)["space.mergeText"] as any;
  await expect(syscall.callback({}, "A\n", "B\n", "C\n")).rejects.toThrow(
    "This requires a connection to the server",
  );
});
