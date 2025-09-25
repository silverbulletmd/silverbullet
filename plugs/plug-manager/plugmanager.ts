import {
  editor,
  events,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { builtinPlugPaths } from "../builtin_plugs.ts";
import type { ResolvedPlug } from "@silverbulletmd/silverbullet/type/event";

export async function reloadPlugsCommand() {
  console.log("Reloading plug...");
  await system.reloadPlugs();
}

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
    const allCustomPlugPaths: string[] = [];
    for (const plugUri of plugList) {
      const [protocol, ...rest] = plugUri.split(":");

      const manifests = await events.dispatchEvent(
        `get-plug:${protocol}`,
        rest.join(":"),
      );

      if (manifests.length === 0) {
        console.error("Could not resolve plug uri", plugUri);
      } else if (manifests.length > 1) {
        console.error(
          `Got multiple results for plug uri ${plugUri}. Proceeding with the first result`,
        );
      }

      const manifest = manifests[0] as unknown;

      let code: string;
      if (typeof manifest === "string") {
        // "Legacy" syntax
        code = manifest;
      } else if (
        manifest &&
        typeof manifest === "object" &&
        "code" in manifest &&
        typeof manifest.code === "string"
      ) {
        code = manifest.code;
      } else {
        console.error(
          "Invalid return from `get-plug` event. Please return value of type `{ code: string, name?: string } | string`",
        );

        continue;
      }

      let name: string;
      if (
        typeof manifest !== "object" ||
        !("name" in manifest) ||
        typeof manifest.name !== "string"
      ) {
        // Try taking a good guess at a name if it isn't provided
        const match = /\/([^\/]+)\.plug\.js$/.exec(plugUri);
        if (!match) {
          console.error(
            `No plug name provided and could not extract name from ${plugUri} ignoring...`,
          );

          continue;
        }

        name = match[1];
      } else {
        name = manifest.name;
      }

      const path = `_plug/${name}.plug.js`;

      // Validate the extracted path
      if (builtinPlugPaths.includes(path)) {
        throw new Error(
          `Plug '${path}' is conflicting with a built-in plug`,
        );
      }
      if (allCustomPlugPaths.includes(path)) {
        throw new Error(
          `Plug '${path}' defined by more than one URI`,
        );
      }

      allCustomPlugPaths.push(path);

      console.log("Writing", path);
      await space.writeDocument(path, new TextEncoder().encode(code));
    }

    const allPlugPaths = [...builtinPlugPaths, ...allCustomPlugPaths];
    // And delete extra ones
    for (const { name: existingPlug } of await space.listPlugs()) {
      if (!allPlugPaths.includes(existingPlug)) {
        console.log("Deleting", existingPlug);
        await space.deleteDocument(existingPlug);
      }
    }
    await editor.flashNotification("All done!");
    system.reloadPlugs();
  } catch (e: any) {
    editor.flashNotification("Error updating plugs: " + e.message, "error");
  }
}

export async function getPlugHTTPS(url: string): Promise<ResolvedPlug> {
  const fullUrl = `https:${url}`;
  console.log("Now fetching plug code from", fullUrl);
  const req = await fetch(fullUrl);
  if (req.status !== 200) {
    throw new Error(`Could not fetch plug code from ${fullUrl}`);
  }
  return req.text();
}

export function getPlugGithub(identifier: string): Promise<ResolvedPlug> {
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
): Promise<ResolvedPlug> {
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
  // Support plug like foo.plug.js are in repo silverbullet-foo
  const shortName = repo.startsWith("silverbullet-")
    ? repo.slice("silverbullet-".length)
    : undefined;
  for (const asset of releaseInfo.assets ?? []) {
    if (
      asset.name === `${repo}.plug.js` ||
      shortName && asset.name === `${shortName}.plug.js`
    ) {
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
  const code = await getPlugHTTPS(finalUrl);
  return {
    code: typeof code === "string" ? code : code.code,
    name: shortName ?? repo,
  };
}
