import { getLogs } from "@plugos/plugos-syscall/sandbox";
import {
  getText,
  hidePanel,
  showPanel,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { getServerLogs } from "@silverbulletmd/plugos-silverbullet-syscall/sandbox";

export async function parsePageCommand() {
  console.log(
    "AST",
    JSON.stringify(await parseMarkdown(await getText()), null, 2)
  );
}

export async function showLogsCommand() {
  let clientLogs = await getLogs();
  let serverLogs = await getServerLogs();

  await showPanel(
    "bhs",
    1,
    `
    <style>
    #client-log-header {
        position: absolute;
        left: 0;
        top: 5px;
    }
    #server-log-header {
        position: absolute;
        right: 0;
        top: 5px;
        width: 50%;
    }
    #client-log {
        position: absolute;
        left: 0;
        top: 30px;
        bottom: 0;
        width: 50%;
        overflow: scroll;
    }
    #server-log {
        position: absolute;
        right: 0;
        top: 30px;
        bottom: 0;
        width: 50%;
        overflow: scroll;
    }
    </style>
    <div id="client-log-header">Client logs (max 100)</div>
    <div id="client-log">
      <pre>${clientLogs
        .map((le) => `[${le.level}] ${le.message}`)
        .join("\n")}</pre>
    </div>
    <div id="server-log-header">Server logs (max 100)</div>
    <div id="server-log">
      <pre>${serverLogs
        .map((le) => `[${le.level}] ${le.message}`)
        .join("\n")}</pre>
    </div>`,
    `
      var clientDiv = document.getElementById("client-log");
      clientDiv.scrollTop = clientDiv.scrollHeight;
      var serverDiv = document.getElementById("server-log");
      serverDiv.scrollTop = serverDiv.scrollHeight;
      if(window.reloadInterval) {
        clearInterval(window.reloadInterval);
      }
      window.reloadInterval = setInterval(() => {
        sendEvent("log:reload");
      }, 1000);
      `
  );
}

export async function hideBhsCommand() {
  await hidePanel("bhs");
}
