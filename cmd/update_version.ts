import { version } from "../version.ts";

export async function updateVersionFile() {
  const command = new Deno.Command("git", {
    args: ["describe", "--tags", "--long"],
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout } = await command.output();
  let commitVersion = new TextDecoder().decode(stdout).trim();

  if (!commitVersion) {
    // Probably no valid .git repo, fallback to GITHUB_SHA env var (used in CI)
    commitVersion = `${version}-${Deno.env.get("GITHUB_SHA") || "unknown"}`;
  }

  const versionFilePath = "./public_version.ts";
  const versionContent = `export const publicVersion = "${commitVersion}";`;

  await Deno.writeTextFile(versionFilePath, versionContent);
  console.log(
    `Updated public_version.ts with version information: ${commitVersion}`,
  );
}
