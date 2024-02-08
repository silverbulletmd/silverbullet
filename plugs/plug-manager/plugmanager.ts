import { editor, events, space, system } from "$sb/syscalls.ts";
import { readYamlPage } from "$sb/lib/yaml_page.ts";
import { builtinPlugNames } from "../builtin_plugs.ts";
import { plugPrefix } from "$common/spaces/constants.ts";

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

      const plugNameMatch = /\/([^\/]+)\.plug\.js$/.exec(plugUri);
      if (!plugNameMatch) {
        console.error(
          "Could not extract plug name from ",
          plugUri,
          "ignoring...",
        );
        continue;
      }

      const plugName = plugNameMatch[1];

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
        `${plugPrefix}${plugName}.plug.js`,
        new TextEncoder().encode(workerCode),
      );
    }

    const allPlugNames = [...builtinPlugNames, ...allCustomPlugNames];
    // And delete extra ones
    for (const { name: existingPlug } of await space.listPlugs()) {
      const plugName = existingPlug.substring(
        plugPrefix.length,
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
  if (!version || version === "latest") {
    console.log("fetching the latest version");
    const req = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    );
    if (req.status !== 200) {
      throw new Error(
        `Could not fetch latest relase manifest from ${identifier}}`,
      );
    }
    const result = await req.json();
    version = result.name;
  }
  const finalUrl =
    `//github.com/${owner}/${repo}/releases/download/${version}/${repo}.plug.js`;
  return getPlugHTTPS(finalUrl);
}
