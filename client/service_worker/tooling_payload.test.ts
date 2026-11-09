import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "../spaces/datastore_space_primitives.ts";
import { buildToolingPayload } from "./tooling_payload.ts";

const fixtureRoot = join(__dirname, "../../testdata/tooling");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// Parity with the Rust endpoint: both must produce testdata/tooling/expected.json.
test("buildToolingPayload matches the shared fixture", async () => {
  const space = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const spaceDir = join(fixtureRoot, "space");
  for (const file of listFiles(spaceDir)) {
    await space.writeFile(
      relative(spaceDir, file).split("\\").join("/"),
      new Uint8Array(readFileSync(file)),
    );
  }
  const payload = (await buildToolingPayload(space)).map((f) => ({
    ...f,
    lastModified: 0,
  }));
  const expected = JSON.parse(
    readFileSync(join(fixtureRoot, "expected.json"), "utf-8"),
  );
  expect(payload).toEqual(expected);
});
