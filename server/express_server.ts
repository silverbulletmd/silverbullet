import { Express } from "express";
import { System } from "../plugbox/runtime";
import { SilverBulletHooks } from "../common/manifest";
import { exposeSystem } from "../plugbox/endpoints";
import { readFile } from "fs/promises";

export class ExpressServer {
  app: Express;
  system: System<SilverBulletHooks>;
  private rootPath: string;

  constructor(
    app: Express,
    rootPath: string,
    distDir: string,
    system: System<SilverBulletHooks>
  ) {
    this.app = app;
    this.rootPath = rootPath;
    this.system = system;

    app.use(exposeSystem(this.system));

    // Fallback, serve index.html
    let cachedIndex: string | undefined = undefined;
    app.get("/*", async (req, res) => {
      if (!cachedIndex) {
        cachedIndex = await readFile(`${distDir}/index.html`, "utf8");
      }
      res.status(200).header("Content-Type", "text/html").send(cachedIndex);
    });
  }

  async init() {}
}
