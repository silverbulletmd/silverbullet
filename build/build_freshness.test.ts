import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { staleArtifacts } from "./build_freshness.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sb-freshness-"));
  mkdirSync(join(root, "src"));
  const touch = (rel: string, seconds: number) => {
    const path = join(root, rel);
    writeFileSync(path, "x");
    utimesSync(path, seconds, seconds);
    return path;
  };
  return { root, touch };
}

test("an artifact older than one of its inputs is stale", () => {
  const { root, touch } = fixture();
  touch("artifact.js", 1000);
  touch("src/widget.ts", 2000);
  const stale = staleArtifacts([
    {
      artifact: join(root, "artifact.js"),
      inputs: [join(root, "src")],
      rebuild: "npm run build",
    },
  ]);
  expect(stale).toHaveLength(1);
  expect(stale[0]).toContain("src/widget.ts");
  expect(stale[0]).toContain("npm run build");
});

test("an artifact newer than all of its inputs is fresh", () => {
  const { root, touch } = fixture();
  touch("src/widget.ts", 1000);
  touch("artifact.js", 2000);
  expect(
    staleArtifacts([
      {
        artifact: join(root, "artifact.js"),
        inputs: [join(root, "src")],
        rebuild: "npm run build",
      },
    ]),
  ).toEqual([]);
});

test("test files never make an artifact stale", () => {
  const { root, touch } = fixture();
  touch("artifact.js", 1000);
  touch("src/widget.test.ts", 2000);
  expect(
    staleArtifacts([
      {
        artifact: join(root, "artifact.js"),
        inputs: [join(root, "src")],
        rebuild: "npm run build",
      },
    ]),
  ).toEqual([]);
});

test("a missing artifact is reported", () => {
  const { root } = fixture();
  const stale = staleArtifacts([
    {
      artifact: join(root, "missing.js"),
      inputs: [join(root, "src")],
      rebuild: "npm run build",
    },
  ]);
  expect(stale[0]).toContain("missing");
});
