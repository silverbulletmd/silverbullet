import { version } from "../version.ts";

export async function upgradeCommand() {
  console.log("Now going to attempt an upgrade...");

  const command = new Deno.Command("deno", {
    args: ["cache", "--reload", Deno.mainModule],
    stdout: "inherit",
    stderr: "inherit",
  });
  const commandOutput = await command.output();
  if (!commandOutput.success) {
    console.error("Something went wrong there...");
    Deno.exit(1);
  }
  console.log(
    "So, that's done. Now let's see if this actually did anything...",
  );
  const vp = new Deno.Command("deno", {
    args: ["run", "-A", Deno.mainModule, "version"],
  });
  const versionStatus = await vp.output();
  if (!versionStatus.success) {
    console.error("Could not run version command, something is wrong.");
    Deno.exit(1);
  }
  const newVersion = new TextDecoder().decode(versionStatus.stdout).trim();
  if (newVersion === version) {
    console.log(
      `Nope. I hate to tell you this, but it looks like we're still running ${newVersion}. This was a bit of a futile exercise. Let's try again soon some time.`,
    );
  } else {
    console.log(
      `Congrats, we've upgraded you from ${version} to ${newVersion}. Seems like quite a bump, enjoy! https://silverbullet.md/CHANGELOG may give you more hints on what's new.`,
    );
  }
}

// WIP: This is not yet working, but it's a start
import { dirname } from "$std/path/mod.ts";

const silverBulletReleases =
  "https://github.com/silverbulletmd/silverbullet/releases";

export async function compiledUpgradeCommand() {
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
