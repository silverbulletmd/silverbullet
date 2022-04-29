import * as crypto from "crypto";
import { Knex } from "knex";
import { promisify } from "util";
const pbkdf2 = promisify(crypto.pbkdf2);

type Account = {
  username: string;
  hashed_password: any;
  salt: any;
};

export class Authenticator {
  tableName = "tokens";

  constructor(private db: Knex<any, unknown[]>) {}

  middleware(req: any, res: any, next: any) {
    console.log("GOing through here", req.headers.authorization);
    // if (req.headers)
    next();
  }

  async ensureTables() {
    if (!(await this.db.schema.hasTable(this.tableName))) {
      await this.db.schema.createTable(this.tableName, (table) => {
        table.string("username");
        table.binary("hashed_password");
        table.binary("salt");
        table.primary(["username"]);
      });
      //   await this.createAccount("admin", "admin");
      console.log(`Created table ${this.tableName}`);
    }
  }

  async createAccount(username: string, password: string) {
    var salt = crypto.randomBytes(16);
    let encryptedPassword = await pbkdf2(password, salt, 310000, 32, "sha256");
    await this.db<Account>(this.tableName).insert({
      username,
      hashed_password: encryptedPassword,
      salt,
    });
  }

  async updatePassword(username: string, password: string) {
    var salt = crypto.randomBytes(16);
    let encryptedPassword = await pbkdf2(password, salt, 310000, 32, "sha256");
    await this.db<Account>(this.tableName).update({
      username,
      hashed_password: encryptedPassword,
      salt,
    });
  }

  async verify(username: string, password: string): Promise<boolean> {
    let users = await this.db<Account>(this.tableName).where({ username });
    if (users.length === 0) {
      throw new Error(`No such user: ${username}`);
    }
    let user = users[0];
    let encryptedPassword = await pbkdf2(
      password,
      user.salt,
      310000,
      32,
      "sha256"
    );
    return crypto.timingSafeEqual(user.hashed_password, encryptedPassword);
  }
}
