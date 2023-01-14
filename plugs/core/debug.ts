import { sandbox } from "$sb/plugos-syscall/mod.ts";
import {
  editor,
  markdown,
  sandbox as serverSandbox,
  system,
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
  // Running in client/server mode?
  const clientServer = !!(await system.getEnv());

  if (clientServer) {
    const clientLogs = await sandbox.getLogs();
    const serverLogs = await serverSandbox.getServerLogs();
    await editor.showPanel(
      "bhs",
      1,
      `
    <style>
    #reload {
      width: 75%;
    }
    #close {
      width: 20%;
    }
    #client-log-header {
        position: absolute;
        left: 0;
        top: 35px;
    }
    #server-log-header {
        position: absolute;
        right: 0;
        top: 35px;
        width: 50%;
    }
    #client-log {
        position: absolute;
        left: 0;
        top: 60px;
        bottom: 0;
        width: 50%;
        overflow: scroll;
    }
    #server-log {
        position: absolute;
        right: 0;
        top: 60px;
        bottom: 0;
        width: 50%;
        overflow: scroll;
    }
    </style>
    <button onclick="self.reloadLogs()" id="reload">Reload</button>
    <button onclick="self.close()" id="close">Close</button>
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

      self.reloadLogs = () => {
        sendEvent("log:reload");
      };
      self.close = () => {
        sendEvent("log:hide");
      };
      `,
    );
  } else {
    const logs = await sandbox.getLogs();
    await editor.showPanel(
      "bhs",
      1,
      `
        <style>
        #reload {
          width: 75%;
        }
        #close {
          width: 20%;
        }
        #log-header {
          position: absolute;
          left: 0;
          top: 35px;
        }
        #log {
          position: absolute;
          left: 0;
          top: 60px;
          bottom: 0;
          width: 100%;
          overflow: scroll;
        }
        </style>
        <button onclick="self.reloadLogs()" id="reload">Reload</button>
        <button onclick="self.close()" id="close">Close</button>
            <div id="log-header">Logs (max 100)</div>
        <div id="log">
          <pre>${
        logs
          .map((le) => `[${le.level}] ${le.message}`)
          .join("\n")
      }</pre>
        </div>`,
      `
          var clientDiv = document.getElementById("log");
          clientDiv.scrollTop = clientDiv.scrollHeight;
          self.reloadLogs = () => {
            sendEvent("log:reload");
          };
          self.close = () => {
            sendEvent("log:hide");
          };
          `,
    );
  }
}

export async function hideBhsCommand() {
  await editor.hidePanel("bhs");
}
