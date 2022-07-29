import { dispatch } from "@plugos/plugos-syscall/event";
import { Manifest } from "@silverbulletmd/common/manifest";
import {
  flashNotification,
  save,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import {
  deletePage,
  listPages,
  writePage,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import {
  invokeFunction,
  reloadPlugs,
} from "@silverbulletmd/plugos-silverbullet-syscall/system";

import { readYamlPage } from "../lib/yaml_page";

async function listPlugs(): Promise<string[]> {
  let unfilteredPages = await listPages(true);
  return unfilteredPages
    .filter((p) => p.name.startsWith("_plug/"))
    .map((p) => p.name.substring("_plug/".length));
}

export async function updatePlugsCommand() {
  await save();
  flashNotification("Updating plugs...");
  try {
    await invokeFunction("server", "updatePlugs");
    flashNotification("And... done!");
    await reloadPlugs();
  } catch (e: any) {
    flashNotification("Error updating plugs: " + e.message, "error");
  }
}

export async function updatePlugs() {
  let plugList: string[] = [];
  try {
    const plugListRead: any[] = await readYamlPage("PLUGS");
    console.log(plugList);
    plugList = plugListRead.filter((plug) => typeof plug === 'string');
    if (plugList.length !== plugListRead.length) {
      throw new Error(`Some of the plugs were not in a yaml list format, they were ignored`);
    }
  } catch (e: any) {
    throw new Error(`Error processing PLUGS: ${e.message}`);
  }
  console.log("Plug YAML", plugList);
  let allPlugNames: string[] = [];
  for (let plugUri of plugList) {
    let [protocol, ...rest] = plugUri.split(":");
    let manifests = await dispatch(`get-plug:${protocol}`, rest.join(":"));
    if (manifests.length === 0) {
      console.error("Could not resolve plug", plugUri);
    }
    // console.log("Got manifests", plugUri, protocol, manifests);
    let manifest = manifests[0];
    allPlugNames.push(manifest.name);
    // console.log("Writing", `_plug/${manifest.name}`);
    await writePage(
      `_plug/${manifest.name}`,
      JSON.stringify(manifest, null, 2)
    );
  }

  // And delete extra ones
  for (let existingPlug of await listPlugs()) {
    if (!allPlugNames.includes(existingPlug)) {
      console.log("Removing plug", existingPlug);
      await deletePage(`_plug/${existingPlug}`);
    }
  }
  await reloadPlugs();
}

export async function getPlugHTTPS(url: string): Promise<Manifest> {
  let fullUrl = `https:${url}`;
  console.log("Now fetching plug manifest from", fullUrl);
  let req = await fetch(fullUrl);
  if (req.status !== 200) {
    throw new Error(`Could not fetch plug manifest from ${fullUrl}`);
  }
  let json = await req.json();

  return json;
}

export async function getPlugGithub(identifier: string): Promise<Manifest> {
  let [owner, repo, path] = identifier.split("/");
  let [repoClean, branch] = repo.split("@");
  if (!branch) {
    branch = "main"; // or "master"?
  }
  return getPlugHTTPS(
    `//raw.githubusercontent.com/${owner}/${repoClean}/${branch}/${path}`
  );
}

export async function getPlugGithubRelease(identifier: string): Promise<Manifest> {
  let [owner, repo, version] = identifier.split("/");
  if (!version || version === "latest") {
    console.log('fetching the latest version');
    const req = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (req.status !== 200) {
      throw new Error(`Could not fetch latest relase manifest from ${identifier}}`);
    }
    const result = await req.json();
    version = result.name;
  } 
  const finalUrl = `//github.com/${owner}/${repo}/releases/download/${version}/${repo}.plug.json`;
  return getPlugHTTPS(finalUrl);
}