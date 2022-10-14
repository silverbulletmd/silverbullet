import { sandbox } from "$sb/plugos-syscall/mod.ts";
import {
  editor,
  markdown,
  sandbox as serverSandbox,
} from "$sb/silverbullet-syscall/mod.ts";

export async function parsePageCommand() {
  console.log(
    "AST",
    JSON.stringify(
      await markdown.parseMarkdown(await editor.getText()),
      null,
      2,
    ),
  );
}

export async function showLogsCommand() {
  const clientLogs = await sandbox.getLogs();
  const serverLogs = await serverSandbox.getServerLogs();

  await editor.showPanel(
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
      <pre>${
      clientLogs
        .map((le) => `[${le.level}] ${le.message}`)
        .join("\n")
    }</pre>
    </div>
    <div id="server-log-header">Server logs (max 100)</div>
    <div id="server-log">
      <pre>${
      serverLogs
        .map((le) => `[${le.level}] ${le.message}`)
        .join("\n")
    }</pre>
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
      `,
  );
}

export async function hideBhsCommand() {
  await editor.hidePanel("bhs");
}
