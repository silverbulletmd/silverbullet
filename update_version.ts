export async function updateVersionFile() {
  const process = Deno.run({
    cmd: ["git", "describe", "--tags", "--long", "--dirty"],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await process.output();
  const commitHash = new TextDecoder().decode(output).trim();
  process.close();

  const versionFilePath = "./version.ts";
  const versionContent = `export const version = \"${commitHash}\";\n`;

  await Deno.writeTextFile(versionFilePath, versionContent);
  console.log(`Updated version.ts with version information: ${commitHash}`);
}
