import { dirname } from "@std/path";

async function upgrade(urlPrefix: string) {
  const installDir = dirname(Deno.execPath());

  console.log("Install dir:", installDir);

  const tmpDir = Deno.makeTempDirSync();
  const zipUrl = urlPrefix +
    `/silverbullet-server-${Deno.build.os}-${Deno.build.arch}.zip`;
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

export async function upgradeCommand() {
  console.log("Now going to attempt an upgrade...");
  await upgrade(
    "https://github.com/silverbulletmd/silverbullet/releases/latest/download",
  );
}

export async function upgradeEdgeCommand() {
  console.log("Now going to attempt an edge upgrade...");
  await upgrade(
    "https://github.com/silverbulletmd/silverbullet/releases/download/edge",
  );
}
