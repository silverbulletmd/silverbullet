import { ApiProvider, ClientConnection } from "./api";
import knex, { Knex } from "knex";
import path from "path";

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
    return {
      clearPageIndexForPage: async (
        clientConn: ClientConnection,
        page: string
      ) => {
        await this.db<IndexItem>("page_index").where({ page }).del();
      },
      set: async (
        clientConn: ClientConnection,
        page: string,
        key: string,
        value: any
      ) => {
        let changed = await this.db<IndexItem>("page_index")
          .where({ page, key })
          .update("value", JSON.stringify(value));
        if (changed === 0) {
          await this.db<IndexItem>("page_index").insert({
            page,
            key,
            value: JSON.stringify(value),
          });
        }
      },
      get: async (clientConn: ClientConnection, page: string, key: string) => {
        let result = await this.db<IndexItem>("page_index")
          .where({ page, key })
          .select("value");
        if (result.length) {
          return JSON.parse(result[0].value);
        } else {
          return null;
        }
      },
      delete: async (
        clientConn: ClientConnection,
        page: string,
        key: string
      ) => {
        await this.db<IndexItem>("page_index").where({ page, key }).del();
      },
      scanPrefixForPage: async (
        clientConn: ClientConnection,
        page: string,
        prefix: string
      ) => {
        return (
          await this.db<IndexItem>("page_index")
            .where({ page })
            .andWhereLike("key", `${prefix}%`)
            .select("page", "key", "value")
        ).map(({ page, key, value }) => ({
          page,
          key,
          value: JSON.parse(value),
        }));
      },
      scanPrefixGlobal: async (
        clientConn: ClientConnection,
        prefix: string
      ) => {
        return (
          await this.db<IndexItem>("page_index")
            .andWhereLike("key", `${prefix}%`)
            .select("page", "key", "value")
        ).map(({ page, key, value }) => ({
          page,
          key,
          value: JSON.parse(value),
        }));
      },
      deletePrefixForPage: async (
        clientConn: ClientConnection,
        page: string,
        prefix: string
      ) => {
        return this.db<IndexItem>("page_index")
          .where({ page })
          .andWhereLike("key", `${prefix}%`)
          .del();
      },

      clearPageIndex: async (clientConn: ClientConnection) => {
        return this.db<IndexItem>("page_index").del();
      },
    };
  }
}
