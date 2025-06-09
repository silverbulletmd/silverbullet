import { dirname } from "@std/path";

export function upgradeCommand() {
  // TODO: Update this before a proper release
  console.log("Not implemented yet");
}

export async function upgradeEdgeCommand() {
  console.log("Now going to attempt an edge upgrade...");

  const installDir = dirname(Deno.execPath());

  console.log("Install dir:", installDir);

  const tmpDir = Deno.makeTempDirSync();
  // const zipUrl =    "https://github.com/silverbulletmd/silverbullet/releases/download/test-release/silverbullet-server-apple-aarch64.zip";
  const zipUrl =
    `https://github.com/silverbulletmd/silverbullet/releases/download/edge/silverbullet-server-${Deno.build.os}-${Deno.build.arch}.zip`;
  const zipPath = `${tmpDir}/silverbullet.zip`;
  console.log("Downloading from", zipUrl);
  const command = new Deno.Command("curl", {
    args: [
      "-L",
      "-o",
      zipPath,
      zipUrl,
    ],
  });
  const curlOutput = await command.output();
  if (curlOutput.code !== 0) {
    console.error(
      "Download failed",
      new TextDecoder().decode(curlOutput.stderr),
    );
    return;
  }
  console.log(
    "Now going to replace the existing silverbullet binary in",
    installDir,
  );

  const unzipCommand = new Deno.Command("unzip", {
    args: [
      "-o",
      "-d",
      installDir,
      `${tmpDir}/silverbullet.zip`,
    ],
  });
  const zipOutput = await unzipCommand.output();
  if (zipOutput.code !== 0) {
    console.error(
      "Download failed",
      new TextDecoder().decode(curlOutput.stderr),
    );
    return;
  }
  await Deno.chmod(`${installDir}/silverbullet`, 0o755);
  await Deno.remove(zipPath);
  console.log("And done! Restart your server to get the latest and greatest!");
}
