import { version } from "../version.ts";
import { dirname } from "https://deno.land/std@0.186.0/path/mod.ts";

const silverBulletReleases =
  "https://github.com/silverbulletmd/silverbullet/releases";

export async function upgradeCommand() {
  console.log("Now going to attempt an upgrade...");

  const resp = await fetch(`${silverBulletReleases}/latest`, {
    redirect: "manual",
  });
  const versionedUrl = resp.headers.get("location")!;
  const latestVersion = /([^\/]+)$/.exec(versionedUrl);
  if (!latestVersion) {
    console.error("Could not fetch latest version");
  }
  if (version === latestVersion![0]) {
    console.log("No version available, we're done here!");
    return;
  }
  console.log(
    "New version available:",
    latestVersion![0],
    "which I will now personally download. Hang on...",
  );
  const installDir = dirname(new URL(Deno.mainModule).pathname);

  const tmpDir = Deno.makeTempDirSync();
  // const zipUrl =    "https://github.com/silverbulletmd/silverbullet/releases/download/test-release/silverbullet-server-apple-aarch64.zip";
  const zipUrl =
    `${versionedUrl}/download/silverbullet-server-${Deno.build.os}-${Deno.build.arch}.zip`;
  const zipPath = `${tmpDir}/silverbullet.zip`;
  const command = new Deno.Command("curl", {
    args: [
      "-L",
      "-o",
      zipPath,
      zipUrl,
    ],
  });
  const curlOutput = await command.output();
  console.log(
    "Now going to replace the existing silverbullet binary in",
    installDir,
  );
  if (curlOutput.code !== 0) {
    console.error(
      "Download failed",
      new TextDecoder().decode(curlOutput.stderr),
    );
    return;
  }
  // console.log(zipPath);

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
