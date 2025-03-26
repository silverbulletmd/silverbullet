import {
  editor,
  events,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { builtinPlugNames } from "../builtin_plugs.ts";

export async function updatePlugsCommand() {
  // Save the current file (could be a config page)
  await editor.save();
  // Reload the config and commands
  await editor.reloadConfigAndCommands();
  await editor.flashNotification("Updating plugs...");
  try {
    const plugList: string[] = [];
    let configPlugs: any[] = await system.getConfig("plugs", []);
    if (Object.keys(configPlugs).length === 0) {
      // Handle case of empty Lua table
      configPlugs = [];
    }
    if (!Array.isArray(configPlugs)) {
      throw new Error("Expected 'plugs' in Space Config to be an array");
    }
    const stringPlugs = configPlugs.filter((plug) => typeof plug === "string");
    if (stringPlugs.length !== configPlugs.length) {
      throw new Error(
        `${
          configPlugs.length - stringPlugs.length
        } plugs in Space Config aren't set as strings`,
      );
    }
    plugList.push(...stringPlugs);

    // De-duplicate URIs, this is safe because by definition they point to the same plug
    plugList.forEach((uri, index) => {
      if (plugList.indexOf(uri) !== index) {
        plugList.splice(index, 1);
      }
    });

    console.log("Found Plug URIs:", plugList);
    const allCustomPlugNames: string[] = [];
    for (const plugUri of plugList) {
      const [protocol, ...rest] = plugUri.split(":");

      let plugName: string;
      if (protocol == "ghr") {
        // For GitHub Release, the plug is expected to be named same as repository
        plugName = rest[0].split("/")[1]; // skip repo owner
        // Strip "silverbullet-foo" into "foo" (multiple plugs follow this convention)
        if (plugName.startsWith("silverbullet-")) {
          plugName = plugName.slice("silverbullet-".length);
        }
      } else {
        // Other URIs are expected to contain the file .plug.js at the end
        const plugNameMatch = /\/([^\/]+)\.plug\.js$/.exec(plugUri);
        if (!plugNameMatch) {
          console.error(
            "Could not extract plug name from ",
            plugUri,
            "ignoring...",
          );
          continue;
        }

        plugName = plugNameMatch[1];
      }

      // Validate the extracted name
      if (builtinPlugNames.includes(plugName)) {
        throw new Error(
          `Plug name '${plugName}' is conflicting with a built-in plug`,
        );
      }
      if (allCustomPlugNames.includes(plugName)) {
        throw new Error(
          `Plug name '${plugName}' defined by more than one URI`,
        );
      }

      const manifests = await events.dispatchEvent(
        `get-plug:${protocol}`,
        rest.join(":"),
      );
      if (manifests.length === 0) {
        console.error("Could not resolve plug", plugUri);
      }
      // console.log("Got manifests", plugUri, protocol, manifests);
      const workerCode = manifests[0] as string;
      allCustomPlugNames.push(plugName);
      console.log("Writing", `_plug/${plugName}.plug.js`);
      await space.writeDocument(
        `_plug/${plugName}.plug.js`,
        new TextEncoder().encode(workerCode),
      );
    }

    console.log("This part is done");

    const allPlugNames = [...builtinPlugNames, ...allCustomPlugNames];
    // And delete extra ones
    for (const { name: existingPlug } of await space.listPlugs()) {
      const plugName = existingPlug.substring(
        "_plug/".length,
        existingPlug.length - ".plug.js".length,
      );
      if (!allPlugNames.includes(plugName)) {
        console.log("Deleting", existingPlug);
        await space.deleteDocument(existingPlug);
      }
    }
    await editor.flashNotification(
      "All done!",
    );
    system.reloadPlugs();
  } catch (e: any) {
    editor.flashNotification("Error updating plugs: " + e.message, "error");
  }
}

export async function getPlugHTTPS(url: string): Promise<string> {
  const fullUrl = `https:${url}`;
  console.log("Now fetching plug code from", fullUrl);
  const req = await fetch(fullUrl);
  if (req.status !== 200) {
    throw new Error(`Could not fetch plug code from ${fullUrl}`);
  }
  return req.text();
}

export function getPlugGithub(identifier: string): Promise<string> {
  const [owner, repo, path] = identifier.split("/");
  let [repoClean, branch] = repo.split("@");
  if (!branch) {
    branch = "main"; // or "master"?
  }
  return getPlugHTTPS(
    `//raw.githubusercontent.com/${owner}/${repoClean}/${branch}/${path}`,
  );
}

export async function getPlugGithubRelease(
  identifier: string,
): Promise<string> {
  let [owner, repo, version] = identifier.split("/");
  let releaseInfo: any = {};
  let req: Response;
  if (!version || version === "latest") {
    console.log(`Fetching release manifest of latest version for ${repo}`);
    req = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    );
  } else {
    console.log(`Fetching release manifest of version ${version} for ${repo}`);
    req = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`,
    );
  }
  if (req.status !== 200) {
    throw new Error(
      `Could not fetch release manifest from ${identifier}`,
    );
  }
  releaseInfo = await req.json();
  version = releaseInfo.tag_name;

  let assetName: string | undefined;
  const shortName = repo.startsWith("silverbullet-")
    ? repo.slice("silverbullet-".length)
    : undefined;
  for (const asset of releaseInfo.assets ?? []) {
    if (asset.name === `${repo}.plug.js`) {
      assetName = asset.name;
      break;
    }
    // Support plug like foo.plug.js are in repo silverbullet-foo
    if (shortName && asset.name === `${shortName}.plug.js`) {
      assetName = asset.name;
      break;
    }
  }
  if (!assetName) {
    throw new Error(
      `Could not find "${repo}.plug.js"` +
        (shortName ? ` or "${shortName}.plug.js"` : "") +
        ` in release ${version}`,
    );
  }

  const finalUrl =
    `//github.com/${owner}/${repo}/releases/download/${version}/${assetName}`;
  return getPlugHTTPS(finalUrl);
}
