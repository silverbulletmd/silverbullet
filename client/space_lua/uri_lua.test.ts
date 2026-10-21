import { describe, expect, test } from "vitest";
import { loadStdPages } from "./std_page_harness_test_util.ts";

describe("URI.md", () => {
  async function readWith(status: number, body: unknown) {
    const h = await loadStdPages(
      ["libraries/Library/Std/Infrastructure/URI.md"],
      {
        virtualPage: { define: () => undefined },
        net: {
          proxyFetch: () => ({
            ok: status >= 200 && status < 300,
            status,
            body,
          }),
        },
      },
    );
    const reader = h.services.find(
      (s) => s.selector === "net.readURI:https:*",
    )!;
    // Errors as strings: Lua error objects don't survive vitest's reporting
    return (async () =>
      reader.run({ uri: "https://example.com/Lib.md" }))().catch(
      (e: Error) => `THREW ${e.message}`,
    );
  }

  test("the https reader returns the body of a success", async () => {
    expect(await readWith(200, "Hello")).toBe("Hello");
  });

  test("a missing page reads as nil, other failures as errors", async () => {
    expect(await readWith(404, "<html>Not found</html>")).toBeFalsy();
    expect(await readWith(500, "<html>Oops</html>")).toMatch(/^THREW .*500/);
    expect(await readWith(405, "Read only mode")).toMatch(/^THREW .*405/);
  });
});
