import { editor, markdown } from "$sb/silverbullet-syscall/mod.ts";

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
  await editor.showPanel(
    "bhs",
    1,
    `
    <style>
    #close {
      width: 100%;
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
    <button onclick="self.close()" id="close">Close</button>
    <div id="client-log-header">Client logs (max 100)</div>
    <div id="client-log">Loading...</div>
    <div id="server-log-header">Server logs (max 100)</div>
    <div id="server-log">Loading...</div>`,
    `
      const clientDiv = document.getElementById("client-log");
      clientDiv.scrollTop = clientDiv.scrollHeight;
      const serverDiv = document.getElementById("server-log");
      serverDiv.scrollTop = serverDiv.scrollHeight;

      self.close = () => {
        sendEvent("log:hide");
      };

      syscall("system.getEnv").then((env) => {
        const clientServerMode = !!env;
        if (!clientServerMode) {
          // Running in hybrid mode (mobile), so let's ignore server logs (they're the same as client logs)
          serverDiv.style.display = "none";
          clientDiv.style.width = "100%";
          document.getElementById("server-log-header").style.display = "none";
        }
  
        setInterval(() => {
          Promise.resolve().then(async () => {
            if(clientServerMode) {
              const serverLogs = await syscall("sandbox.getServerLogs");
              serverDiv.innerHTML = "<pre>" + serverLogs.map((le) => "[" + le.level + "] " + le.message).join("\\n") + "</pre>";
            }
            const clientLogs = await syscall("sandbox.getLogs");
            clientDiv.innerHTML = "<pre>" + clientLogs.map((le) => "[" + le.level + "] " + le.message).join("\\n") + "</pre>";
          }).catch(console.error);
        }, 1000);
      });
      `,
  );
}

export async function hideBhsCommand() {
  await editor.hidePanel("bhs");
}
