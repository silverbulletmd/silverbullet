import { get, set } from "@plugos/plugos-syscall/store";
import { flashNotification } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import {
  getVersion,
  invokeFunction,
} from "@silverbulletmd/plugos-silverbullet-syscall/system";

export async function editorInit() {
  let currentVersion = await getVersion();
  console.log("Running version check", currentVersion);
  let lastVersion = await get("$silverBulletVersion");
  console.log("Last version", lastVersion);
  if (lastVersion !== currentVersion) {
    await flashNotification(
      "Version update detected, going to reload plugs..."
    );
    await set("$spaceIndexed", false);
    await set("$silverBulletVersion", currentVersion);
    invokeFunction("client", "updatePlugsCommand");
  } else {
    let spaceIndexed = await get("$spaceIndexed");
    console.log("Space indexed", spaceIndexed);
    if (!spaceIndexed) {
      await set("$spaceIndexed", true);
      await invokeFunction("client", "reindexSpaceCommand");
      // Resetting this, because part of the reindex will be to wipe this too
      await set("$silverBulletVersion", currentVersion);
    }
  }
}
