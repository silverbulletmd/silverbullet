import { Capacitor } from "../../mobile/deps.ts";
import { CapacitorSQLite } from "../deps.ts";
import { ISQLite } from "./sqlite_interface.ts";

export class CapacitorDb implements ISQLite {
  constructor(readonly name: string) {
  }
  async init() {
    await CapacitorSQLite.createConnection({
      database: this.name,
    });
    await CapacitorSQLite.open({
      database: this.name,
    });
  }

  async query(sql: string, ...args: any[]) {
    const result = await CapacitorSQLite.query({
      statement: sql,
      database: this.name,
      values: args,
    });
    console.log("Query results", result.values);
    if (Capacitor.getPlatform() === "ios") {
      return result.values!.slice(1);
    }
    return result.values!;
  }

  async execute(sql: string, ...args: any[]): Promise<number> {
    return (await CapacitorSQLite.run({
      statement: sql,
      database: this.name,
      values: args,
    })).changes!.changes!;
  }
}
