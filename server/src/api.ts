import { Server, Socket } from "socket.io";
import { Page } from "./types";
import * as path from "path";
import { IndexApi } from "./index_api";
import { PageApi } from "./page_api";

export class ClientConnection {
  openPages = new Set<string>();
  constructor(readonly sock: Socket) {}
}

export interface ApiProvider {
  init(): Promise<void>;
  api(): Object;
}

export class SocketServer {
  rootPath: string;
  openPages = new Map<string, Page>();
  connectedSockets = new Set<Socket>();
  serverSocket: Server;
  private apis = new Map<string, ApiProvider>();

  async registerApi(name: string, apiProvider: ApiProvider) {
    await apiProvider.init();
    this.apis.set(name, apiProvider);
  }

  constructor(rootPath: string, serverSocket: Server) {
    this.rootPath = path.resolve(rootPath);
    this.serverSocket = serverSocket;
  }

  public async init() {
    await this.registerApi("index", new IndexApi(this.rootPath));
    await this.registerApi(
      "page",
      new PageApi(this.rootPath, this.connectedSockets)
    );

    this.serverSocket.on("connection", (socket) => {
      const clientConn = new ClientConnection(socket);

      console.log("Connected", socket.id);
      this.connectedSockets.add(socket);

      socket.on("disconnect", () => {
        console.log("Disconnected", socket.id);
        clientConn.openPages.forEach(disconnectPageSocket);
        this.connectedSockets.delete(socket);
      });

      socket.on("closePage", (pageName: string) => {
        console.log("Closing page", pageName);
        clientConn.openPages.delete(pageName);
        disconnectPageSocket(pageName);
      });

      const onCall = (
        eventName: string,
        cb: (...args: any[]) => Promise<any>
      ) => {
        socket.on(eventName, (reqId: number, ...args) => {
          cb(...args)
            .then((result) => {
              socket.emit(`${eventName}Resp${reqId}`, null, result);
            })
            .catch((err) => {
              socket.emit(`${eventName}Resp${reqId}`, err.message);
            });
        });
      };

      const disconnectPageSocket = (pageName: string) => {
        let page = this.openPages.get(pageName);
        if (page) {
          for (let client of page.clientStates) {
            if (client.socket === socket) {
              (this.apis.get("page")! as PageApi).disconnectClient(
                client,
                page
              );
            }
          }
        }
      };
      for (let [apiName, apiProvider] of this.apis) {
        Object.entries(apiProvider.api()).forEach(([eventName, cb]) => {
          onCall(`${apiName}.${eventName}`, (...args: any[]): any => {
            // @ts-ignore
            return cb(clientConn, ...args);
          });
        });
      }
    });
  }

  close() {
    (this.apis.get("index")! as IndexApi).db.destroy();
  }
}
