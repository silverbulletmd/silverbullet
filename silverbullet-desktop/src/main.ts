import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Window } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

let port = 3005;

window.addEventListener("load", async () => {
  const spaceFolder = await open({
    multiple: false,
    directory: true,
  });
  if (spaceFolder) {
    await spawnServer(port++, spaceFolder);
    console.log("Now here");
    // const label = `folder:${spaceFolder}`;
    const win = new Window("mylabel");
    win.once("tauri://created", function () {
      console.log("Created windows nicely!");
      // alternatively, load a remote URL:
      const webview = new Webview(win, "theUniqueLabel", {
        url: "https://github.com/tauri-apps/tauri",

        // create a webview with specific logical position and size
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
    });
    console.log("DOne");
  }
});

function spawnServer(port: number, path: string): Promise<void> {
  return new Promise((resolve) => {
    const command = Command.sidecar("bin/silverbullet", [
      "-p",
      "" + port,
      path,
    ]);
    command.on("close", (data) => {
      console.log(
        `command finished with code ${data.code} and signal ${data.signal}`,
      );
    });
    command.on(
      "error",
      (error) => console.error(`command error: "${error}"`),
    );
    command.stdout.on(
      "data",
      (line) => console.log(`command stdout: "${line}"`),
    );

    command.stderr.on(
      "data",
      (line) => {
        console.log(`command stderr: "${line}"`);
        if (line.includes("SilverBullet is now running")) {
          resolve();
        }
      },
    );

    const child = command.spawn();
    console.log("pid:", child.pid);
  });
}
