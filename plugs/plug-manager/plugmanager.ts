import {
  editor,
  events,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { readYamlPage } from "@silverbulletmd/silverbullet/lib/yaml_page";
import { builtinPlugNames } from "../builtin_plugs.ts";

const plugsPrelude =
  "This file lists all plugs that SilverBullet will load. Run the {[Plugs: Update]} command to update and reload this list of plugs.\n\n";

export async function updatePlugsCommand() {
  await editor.save();
  await editor.flashNotification("Updating plugs...");
  try {
    let plugList: string[] = [];
    try {
      const plugListRead: any[] = await readYamlPage("PLUGS");
      if (!Array.isArray(plugListRead)) {
        await editor.flashNotification(
          "PLUGS YAML does not contain a plug list, not loading anything",
          "error",
        );
        return;
      }
      plugList = plugListRead.filter((plug) => typeof plug === "string");
      if (plugList.length !== plugListRead.length) {
        throw new Error(
          `Some of the plugs were not in a yaml list format, they were ignored`,
        );
      }
    } catch (e: any) {
      if (e.message.includes("Not found")) {
        console.warn("No PLUGS page found, not loading anything");
        return;
      }
      throw new Error(`Error processing PLUGS: ${e.message}`);
    }
    console.log("Plug YAML", plugList);
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
      // console.log("Writing", `_plug/${plugName}.plug.js`, workerCode);
      await space.writeAttachment(
        `_plug/${plugName}.plug.js`,
        new TextEncoder().encode(workerCode),
      );
    }

    const allPlugNames = [...builtinPlugNames, ...allCustomPlugNames];
    // And delete extra ones
    for (const { name: existingPlug } of await space.listPlugs()) {
      const plugName = existingPlug.substring(
        "_plug/".length,
        existingPlug.length - ".plug.js".length,
      );
      if (!allPlugNames.includes(plugName)) {
        await space.deleteAttachment(existingPlug);
      }
    }
    await editor.flashNotification("And... done!");
  } catch (e: any) {
    editor.flashNotification("Error updating plugs: " + e.message, "error");
  }
}

export async function addPlugCommand() {
  let name = await editor.prompt("Plug URI:");
  if (!name) {
    return;
  }
  // Support people copy & pasting the YAML version
  if (name.startsWith("-")) {
    name = name.replace(/^\-\s*/, "");
  }
  let plugList: string[] = [];
  try {
    plugList = await readYamlPage("PLUGS");
  } catch (e: any) {
    console.error("ERROR", e);
  }
  if (plugList.includes(name)) {
    await editor.flashNotification("Plug already installed", "error");
    return;
  }
  plugList.push(name);
  // await writeYamlPage("PLUGS", plugList, plugsPrelude);
  await space.writePage(
    "PLUGS",
    plugsPrelude + "```yaml\n" + plugList.map((p) => `- ${p}`).join("\n") +
      "\n```",
  );
  await editor.navigate({ page: "PLUGS" });
  await updatePlugsCommand();
  await editor.flashNotification("Plug added!");
  system.reloadPlugs();
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
