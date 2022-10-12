import { dispatch } from "../../syscall/plugos-syscall/event.ts";
import { Manifest } from "../../common/manifest.ts";
import {
  flashNotification,
  save,
} from "../../syscall/silverbullet-syscall/editor.ts";
import {
  deleteAttachment,
  listPlugs,
  writeAttachment,
} from "../../syscall/silverbullet-syscall/space.ts";
import {
  invokeFunction,
  reloadPlugs,
} from "../../syscall/silverbullet-syscall/system.ts";

import { readYamlPage } from "../lib/yaml_page.ts";

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
    plugList = plugListRead.filter((plug) => typeof plug === "string");
    if (plugList.length !== plugListRead.length) {
      throw new Error(
        `Some of the plugs were not in a yaml list format, they were ignored`,
      );
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
    await writeAttachment(
      `_plug/${manifest.name}.plug.json`,
      "string",
      JSON.stringify(manifest),
    );
  }

  // And delete extra ones
  for (let existingPlug of await listPlugs()) {
    let plugName = existingPlug.substring(
      "_plug/".length,
      existingPlug.length - ".plug.json".length,
    );
    console.log("Considering", plugName);
    if (!allPlugNames.includes(plugName)) {
      console.log("Removing plug", plugName);
      await deleteAttachment(existingPlug);
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
