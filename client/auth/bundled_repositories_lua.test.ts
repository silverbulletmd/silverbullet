import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ShareWorld } from "./share_world_test_util.ts";

// Bundled repositories update through share (the server copies them into the
// space on first write), so each must carry a share.hash of its own text:
// share then sees an unedited page and takes the remote without asking.
const DIR = "libraries/Repositories";

describe("bundled repositories", () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".md"))) {
    test(`${file} is an unedited pull share`, async () => {
      const w = await ShareWorld.create();
      const name = `Repositories/${file.slice(0, -3)}`;
      const text = readFileSync(`${DIR}/${file}`, "utf8");
      w.pages.set(name, text);
      const status = (await w.h.call("share.status", name)) as any;
      expect(status.mode).toBe("pull");
      expect(
        status.state,
        `set share.hash to "${await w.h.call("share.legacyHash", text)}"`,
      ).toBe("unchanged");
    });
  }
});
