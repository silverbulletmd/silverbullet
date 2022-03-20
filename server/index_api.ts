import { ApiProvider, ClientConnection } from "./api_server";
import knex, { Knex } from "knex";
import path from "path";
import pageIndexSyscalls from "./syscalls/page_index";

type IndexItem = {
  page: string;
  key: string;
  value: any;
};

export class IndexApi implements ApiProvider {
  db: Knex;

  constructor(rootPath: string) {
    this.db = knex({
      client: "better-sqlite3",
      connection: {
        filename: path.join(rootPath, "data.db"),
      },
      useNullAsDefault: true,
    });
  }

  async init() {
    if (!(await this.db.schema.hasTable("page_index"))) {
      await this.db.schema.createTable("page_index", (table) => {
        table.string("page");
        table.string("key");
        table.text("value");
        table.primary(["page", "key"]);
      });
      console.log("Created table page_index");
    }
  }

  api() {
    const syscalls = pageIndexSyscalls(this.db);
    return {
      clearPageIndexForPage: async (
        clientConn: ClientConnection,
        page: string
      ) => {
        return syscalls["indexer.clearPageIndexForPage"](page);
      },
      set: async (
        clientConn: ClientConnection,
        page: string,
        key: string,
        value: any
      ) => {
        return syscalls["indexer.set"](page, key, value);
      },
      get: async (clientConn: ClientConnection, page: string, key: string) => {
        return syscalls["indexer.get"](page, key);
      },
      delete: async (
        clientConn: ClientConnection,
        page: string,
        key: string
      ) => {
        return syscalls["indexer.delete"](page, key);
      },
      scanPrefixForPage: async (
        clientConn: ClientConnection,
        page: string,
        prefix: string
      ) => {
        return syscalls["indexer.scanPrefixForPage"](page, prefix);
      },
      scanPrefixGlobal: async (
        clientConn: ClientConnection,
        prefix: string
      ) => {
        return syscalls["indexer.scanPrefixGlobal"](prefix);
      },
      deletePrefixForPage: async (
        clientConn: ClientConnection,
        page: string,
        prefix: string
      ) => {
        return syscalls["indexer.deletePrefixForPage"](page, prefix);
      },

      clearPageIndex: async (clientConn: ClientConnection) => {
        return syscalls["indexer.clearPageIndex"]();
      },
    };
  }
}
