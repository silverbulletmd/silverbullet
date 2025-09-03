import { version } from "../version.ts";

export async function updateVersionFile() {
  const command = new Deno.Command("git", {
    args: ["describe", "--tags", "--long"],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  const commitVersion = new TextDecoder().decode(result.stdout).trim();

  const versionFilePath = "./public_version.ts";
  const versionContent = `
export const publicVersion = "${commitVersion}";
`;

  await Deno.writeTextFile(versionFilePath, versionContent);
  console.log(
    `Updated public_version.ts with version information: ${commitVersion}`,
  );
}
