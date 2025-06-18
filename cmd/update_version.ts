import denoJson from "../deno.json" with {
  type: "json",
};
export async function updateVersionFile() {
  const command = new Deno.Command("git", {
    args: ["describe", "--tags", "--long"],
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout } = await command.output();
  const commitVersion = new TextDecoder().decode(stdout).trim();

  const versionFilePath = "./version.ts";
  const versionContent = `
export const publicVersion = "2.0-beta (${commitVersion})";
export const version = "${denoJson.version}";
`;

  await Deno.writeTextFile(versionFilePath, versionContent);
  console.log(`Updated version.ts with version information: ${commitVersion}`);
}
