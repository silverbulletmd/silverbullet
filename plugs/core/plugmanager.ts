import { events } from "$sb/plugos-syscall/mod.ts";
import type { Manifest } from "../../common/manifest.ts";
import { editor, space, system } from "$sb/silverbullet-syscall/mod.ts";
import { readYamlPage } from "$sb/lib/yaml_page.ts";

const plugsPrelude =
  "This file lists all plugs that SilverBullet will load. Run the {[Plugs: Update]} command to update and reload this list of plugs.\n\n";

export async function updatePlugsCommand() {
  await editor.save();
  await editor.flashNotification("Updating plugs...");
  try {
    await system.invokeFunction("server", "updatePlugs");
    await editor.flashNotification("And... done!");
    system.reloadPlugs();
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
  await editor.navigate("PLUGS");
  await system.invokeFunction("server", "updatePlugs");
  await editor.flashNotification("Plug added!");
  system.reloadPlugs();
}

export async function updatePlugs() {
  let plugList: string[] = [];
  try {
    const plugListRead: any[] = await readYamlPage("PLUGS");
    plugList = plugListRead.filter((plug) => typeof plug === "string");
    if (plugList.length !== plugListRead.length) {
      throw new Error(
        `Some of the plugs were not in a yaml list format, they were ignored`,
      );
    }
  } catch (e: any) {
    if (e.message.includes("Could not read file")) {
      console.warn("No PLUGS page found, not loading anything");
      return;
    }
    throw new Error(`Error processing PLUGS: ${e.message}`);
  }
  console.log("Plug YAML", plugList);
  const allPlugNames: string[] = [];
  for (const plugUri of plugList) {
    const [protocol, ...rest] = plugUri.split(":");
    const manifests = await events.dispatchEvent(
      `get-plug:${protocol}`,
      rest.join(":"),
    );
    if (manifests.length === 0) {
      console.error("Could not resolve plug", plugUri);
    }
    // console.log("Got manifests", plugUri, protocol, manifests);
    const manifest = manifests[0];
    allPlugNames.push(manifest.name);
    // console.log("Writing", `_plug/${manifest.name}`);
    await space.writeAttachment(
      `_plug/${manifest.name}.plug.json`,
      "utf8",
      JSON.stringify(manifest),
    );
  }

  // And delete extra ones
  for (const existingPlug of await space.listPlugs()) {
    const plugName = existingPlug.substring(
      "_plug/".length,
      existingPlug.length - ".plug.json".length,
    );
    if (!allPlugNames.includes(plugName)) {
      await space.deleteAttachment(existingPlug);
    }
  }
  system.reloadPlugs();
}

export async function getPlugHTTPS(url: string): Promise<Manifest> {
  const fullUrl = `https:${url}`;
  console.log("Now fetching plug manifest from", fullUrl);
  const req = await fetch(fullUrl);
  if (req.status !== 200) {
    throw new Error(`Could not fetch plug manifest from ${fullUrl}`);
  }
  return req.json();
}

export function getPlugGithub(identifier: string): Promise<Manifest> {
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
): Promise<Manifest> {
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
    `//github.com/${owner}/${repo}/releases/download/${version}/${repo}.plug.json`;
  return getPlugHTTPS(finalUrl);
}
