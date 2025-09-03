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
    // Probably in CI, let's pull from the GITHUB_SHA file
    commitVersion = `${version}-${Deno.readTextFileSync("GITHUB_SHA").trim()}`;
  }

  const versionFilePath = "./public_version.ts";
  const versionContent = `
export const publicVersion = "${commitVersion}";
`;

  await Deno.writeTextFile(versionFilePath, versionContent);
  console.log(
    `Updated public_version.ts with version information: ${commitVersion}`,
  );
}
