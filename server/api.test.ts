import { test, expect, beforeAll, afterAll, describe } from "@jest/globals";

import { createServer } from "http";
import { io as Client } from "socket.io-client";
import { Server } from "socket.io";
import { SocketServer } from "./api_server";
import * as path from "path";
import * as fs from "fs";

describe("Server test", () => {
  let io: Server,
    socketServer: SocketServer,
    clientSocket: any,
    reqId = 0;
  const tmpDir = path.join(__dirname, "test");

  function wsCall(eventName: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      reqId++;
      clientSocket.once(`${eventName}Resp${reqId}`, (err: any, result: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
      clientSocket.emit(eventName, reqId, ...args);
    });
  }

  beforeAll((done) => {
    const httpServer = createServer();
    io = new Server(httpServer);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(`${tmpDir}/test.md`, "This is a simple test");
    httpServer.listen(async () => {
      // @ts-ignore
      const port = httpServer.address().port;
      // @ts-ignore
      clientSocket = new Client(`http://localhost:${port}`);
      socketServer = new SocketServer(tmpDir, io);
      clientSocket.on("connect", done);
      await socketServer.init();
    });
  });

  afterAll(() => {
    io.close();
    clientSocket.close();
    socketServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("List pages", async () => {
    let pages = await wsCall("page.listPages");
    expect(pages.length).toBe(1);
    await wsCall("page.writePage", "test2.md", "This is another test");
    let pages2 = await wsCall("page.listPages");
    expect(pages2.length).toBe(2);
    await wsCall("page.deletePage", "test2.md");
    let pages3 = await wsCall("page.listPages");
    expect(pages3.length).toBe(1);
  });

  test("Index operations", async () => {
    await wsCall("index.clearPageIndexForPage", "test");
    await wsCall("index.set", "test", "testkey", "value");
    expect(await wsCall("index.get", "test", "testkey")).toBe("value");
    await wsCall("index.delete", "test", "testkey");
    expect(await wsCall("index.get", "test", "testkey")).toBe(null);
    await wsCall("index.set", "test", "unrelated", 10);
    await wsCall("index.set", "test", "unrelated", 12);
    await wsCall("index.set", "test2", "complicated", {
      name: "Bla",
      age: 123123,
    });
    await wsCall("index.set", "test", "complicated", { name: "Bla", age: 100 });
    await wsCall("index.set", "test", "complicated2", {
      name: "Bla",
      age: 101,
    });
    expect(await wsCall("index.get", "test", "complicated")).toStrictEqual({
      name: "Bla",
      age: 100,
    });
    let result = await wsCall("index.scanPrefixForPage", "test", "compli");
    expect(result.length).toBe(2);
    let result2 = await wsCall("index.scanPrefixGlobal", "compli");
    expect(result2.length).toBe(3);
    await wsCall("index.deletePrefixForPage", "test", "compli");
    let result3 = await wsCall("index.scanPrefixForPage", "test", "compli");
    expect(result3.length).toBe(0);
    let result4 = await wsCall("index.scanPrefixGlobal", "compli");
    expect(result4.length).toBe(1);
  });
});
