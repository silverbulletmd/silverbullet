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
