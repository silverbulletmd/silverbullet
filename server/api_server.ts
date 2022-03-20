import { Server, Socket } from "socket.io";
import { Page } from "./types";
import * as path from "path";
import { IndexApi } from "./index_api";
import { PageApi } from "./page_api";
import { System } from "../plugbox/runtime";
import { createSandbox } from "../plugbox/node_sandbox";
import { NuggetHook } from "../webapp/types";
import corePlug from "../webapp/generated/core.plug.json";
import pageIndexSyscalls from "./syscalls/page_index";

export class ClientConnection {
  openPages = new Set<string>();
  constructor(readonly sock: Socket) {}
}

export interface ApiProvider {
  init(): Promise<void>;
  api(): Object;
}

export class SocketServer {
  private openPages = new Map<string, Page>();
  private connectedSockets = new Set<Socket>();
  private apis = new Map<string, ApiProvider>();
  readonly rootPath: string;
  private serverSocket: Server;
  system: System<NuggetHook>;

  constructor(rootPath: string, serverSocket: Server) {
    this.rootPath = path.resolve(rootPath);
    this.serverSocket = serverSocket;
    this.system = new System<NuggetHook>();
  }

  async registerApi(name: string, apiProvider: ApiProvider) {
    await apiProvider.init();
    this.apis.set(name, apiProvider);
  }

  public async init() {
    const indexApi = new IndexApi(this.rootPath);
    await this.registerApi("index", indexApi);
    this.system.registerSyscalls(pageIndexSyscalls(indexApi.db));
    await this.registerApi(
      "page",
      new PageApi(
        this.rootPath,
        this.connectedSockets,
        this.openPages,
        this.system
      )
    );

    let plug = await this.system.load(
      "core",
      corePlug,
      createSandbox(this.system)
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

      socket.on("page.closePage", (pageName: string) => {
        console.log("Client closed page", pageName);
        disconnectPageSocket(pageName);
        clientConn.openPages.delete(pageName);
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
