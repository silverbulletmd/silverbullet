import { staleArtifacts } from "../build/build_freshness.ts";

// The flows run whatever client bundle and debug binary already exist, so a stale build silently tests old code.
export default function globalSetup() {
  if (process.env.CI || process.env.SB_E2E_SKIP_FRESHNESS) return;
  const releaseOnly = process.argv.some(
    (arg, i, all) =>
      arg === "--project=release" ||
      (arg === "--project" && all[i + 1] === "release"),
  );
  const problems = staleArtifacts([
    {
      artifact: "client_bundle/client/.client/client.js",
      inputs: ["client", "plugs", "plug-api", "libraries", "build"],
      rebuild: "npm run build",
    },
    ...(releaseOnly
      ? []
      : [
          {
            artifact: "target/debug/silverbullet",
            inputs: [
              "server",
              "server-common",
              "server-merge",
              "server-runtime-chrome",
              "bin/silverbullet",
              "Cargo.toml",
              "Cargo.lock",
            ],
            rebuild: "cargo build -p silverbullet -p sb",
          },
        ]),
  ]);
  if (problems.length > 0) {
    throw new Error(
      `Stale e2e build (make build-e2e rebuilds both; SB_E2E_SKIP_FRESHNESS=1 skips this check):\n${problems.join("\n")}`,
    );
  }
}
