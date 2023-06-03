// import { Application, Router } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";
import { performLocalFetch } from "../common/proxy_fetch.ts";
import { BuiltinSettings } from "../web/types.ts";
import { gitIgnoreCompiler } from "./deps.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { CollabServer } from "./collab.ts";

// @deno-types="npm:@types/express@4.17.15"
import express from "npm:express@4.18.2";
import cookieParser from "npm:cookie-parser";

// @deno-types="npm:@types/express-ws"
import expressWebsockets from "npm:express-ws@5.0.2";

import { Buffer } from "node:buffer";
// @deno-types="npm:body-parser@1.19.2"
import bodyParser from "npm:body-parser@1.19.2";

export type ServerOptions = {
  hostname: string;
  port: number;
  pagesPath: string;
  clientAssetBundle: AssetBundle;
  user?: string;
  pass?: string;
  certFile?: string;
  keyFile?: string;
  maxFileSizeMB?: number;
};

export class HttpServer {
  private app: express.Express;
  private hostname: string;
  private port: number;
  user?: string;
  abortController?: AbortController;
  clientAssetBundle: AssetBundle;
  settings?: BuiltinSettings;
  spacePrimitives: SpacePrimitives;
  collab: CollabServer;

  constructor(
    spacePrimitives: SpacePrimitives,
    private options: ServerOptions,
  ) {
    this.hostname = options.hostname;
    this.port = options.port;
    this.app = expressWebsockets(express()).app;
    this.user = options.user;
    this.clientAssetBundle = options.clientAssetBundle;

    let fileFilterFn: (s: string) => boolean = () => true;
    this.spacePrimitives = new FilteredSpacePrimitives(
      spacePrimitives,
      (meta) => {
        // Don't list file exceeding the maximum file size
        if (
          options.maxFileSizeMB &&
          meta.size / (1024 * 1024) > options.maxFileSizeMB
        ) {
          return false;
        }
        return fileFilterFn(meta.name);
      },
      async () => {
        await this.reloadSettings();
        if (typeof this.settings?.spaceIgnore === "string") {
          fileFilterFn = gitIgnoreCompiler(this.settings.spaceIgnore).accepts;
        } else {
          fileFilterFn = () => true;
        }
      },
    );
    this.collab = new CollabServer(this.spacePrimitives);
    this.collab.start();
  }

  // Replaces some template variables in index.html in a rather ad-hoc manner, but YOLO
  renderIndexHtml() {
    return this.clientAssetBundle.readTextFileSync(".client/index.html")
      .replaceAll(
        "{{SPACE_PATH}}",
        this.options.pagesPath.replaceAll("\\", "\\\\"),
      ).replaceAll(
        "{{SYNC_ENDPOINT}}",
        "/.fs",
      );
  }

  async start() {
    await this.reloadSettings();
    this.app.use(cookieParser());
    this.app.all(/^(\/((?!\.fs).)*)$/, (req, res) => {
      // console.log(req.path, req.method);
      try {
        const assetName = req.path.slice(1);
        if (this.clientAssetBundle.has(assetName)) {
          console.log("Serving asset", assetName);
          if (
            req.header("If-Modified-Since") ===
              utcDateString(this.clientAssetBundle.getMtime(assetName))
          ) {
            res.status(304);
            res.send();
            return;
          }
          res.status(200);
          res.header(
            "Content-type",
            this.clientAssetBundle.getMimeType(assetName),
          );
          const data = this.clientAssetBundle.readFileSync(
            assetName,
          );
          res.header("Cache-Control", "no-cache");
          // res.header("Content-Length", "" + data.length);
          res.header(
            "Last-Modified",
            utcDateString(this.clientAssetBundle.getMtime(assetName)),
          );

          if (req.method === "GET") {
            const buf = Buffer.from(data);
            console.log("Buffer length", buf.length, assetName);
            res.send(buf);
            // res.send
          } else {
            res.send();
          }
          return;
        }
      } catch (e: any) {
        console.error("Error", e);
      }

      res.status(200);
      res.header("Content-Type", "text/html");
      res.send(this.renderIndexHtml());
    });

    // Pages API
    this.app.use(
      "/.fs",
      // passwordMiddleware,
      this.buildFsRouter(this.spacePrimitives),
    );
    this.app.listen(this.port, this.hostname, () => {
      const visibleHostname = this.hostname === "0.0.0.0"
        ? "localhost"
        : this.hostname;
      console.log(
        `SilverBullet is now running: http://${visibleHostname}:${this.port}`,
      );
    });
    // return;

    // this.collab.route(this.app);
  }

  async reloadSettings() {
    // TODO: Throttle this?
    this.settings = await ensureSettingsAndIndex(this.spacePrimitives);
  }

  private passwordAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];
    if (this.user) {
      const b64User = btoa(this.user);
      if (!excludedPaths.includes(req.path)) {
        const authCookie = req.cookies["auth"];
        if (!authCookie || authCookie !== b64User) {
          res.status(401);
          res.send("Unauthorized, please authenticate");
          return;
        }
      }
      if (req.path === "/.auth") {
        if (req.method === "GET") {
          res.header("Content-type", "text/html");
          res.send(this.clientAssetBundle.readTextFileSync(
            ".client/auth.html",
          ));
          return;
        } else if (req.method === "POST") {
          bodyParser.urlencoded({ extended: false })(req, res, next);
          // const values = req.body;
          const username = req.body.username,
            password = req.body.password,
            refer = req.body.refer;
          if (this.user === `${username}:${password}`) {
            res.cookie("auth", b64User, {
              expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // in a week
              sameSite: "strict",
            });
            res.redirect(refer || "/");
            // console.log("All headers", request.headers);
          } else {
            res.redirect("/.auth?error=1");
          }
          return;
        } else {
          res.status(401);
          res.send("Unauthorized");
          return;
        }
      } else {
        // Unauthenticated access to excluded paths
        next();
      }
    }
  }

  private buildFsRouter(spacePrimitives: SpacePrimitives): express.Router {
    const fsRouter = express.Router();
    // File list
    fsRouter.route("/").get(async (_req, res) => {
      res.header("X-Space-Path", this.options.pagesPath);
      res.json(await spacePrimitives.fetchFileList());
    }).post(
      bodyParser.json({
        type: "*/*",
      }),
      async (req, res) => {
        // console.log("RPC", req.body);
        const body = req.body;
        try {
          switch (body.operation) {
            case "fetch": {
              const result = await performLocalFetch(body.url, body.options);
              console.log("Proxying fetch request to", body.url);
              res.header("Content-Type", "application/json");
              res.send(JSON.stringify(result));
              return;
            }
            case "shell": {
              // TODO: Have a nicer way to do this
              if (this.options.pagesPath.startsWith("s3://")) {
                res.status(500);
                res.header("Content-Type", "application/json");
                res.send(JSON.stringify({
                  stdout: "",
                  stderr: "Cannot run shell commands with S3 backend",
                  code: 500,
                }));
                return;
              }
              const p = new Deno.Command(body.cmd, {
                args: body.args,
                cwd: this.options.pagesPath,
                stdout: "piped",
                stderr: "piped",
              });
              const output = await p.output();
              const stdout = new TextDecoder().decode(output.stdout);
              const stderr = new TextDecoder().decode(output.stderr);

              res.header("Content-Type", "application/json");
              res.send(JSON.stringify({
                stdout,
                stderr,
                code: output.code,
              }));
              return;
            }
            case "ping": {
              // RPC to check (for collab purposes) which client has what page open
              res.header("Content-Type", "application/json");
              // console.log("Got ping", body);
              res.send(JSON.stringify(
                this.collab.ping(body.clientId, body.page),
              ));
              return;
            }
            default:
              res.header("Content-Type", "text/plain");
              res.status(400);
              res.send("Unknown operation");
          }
        } catch (e: any) {
          console.log("Error", e);
          res.status(500);
          res.send(e.message);
          return;
        }
      },
    );

    fsRouter
      .route(/\/(.+)/)
      .get(async (req, res) => {
        const name = req.params[0];

        console.log("Loading file", name);
        try {
          const attachmentData = await spacePrimitives.readFile(
            name,
          );
          const lastModifiedHeader = new Date(attachmentData.meta.lastModified)
            .toUTCString();
          if (req.header("If-Modified-Since") === lastModifiedHeader) {
            res.status(304);
            res.end();
            return;
          }
          res.status(200);
          res.header(
            "X-Last-Modified",
            "" + attachmentData.meta.lastModified,
          );
          res.header("Cache-Control", "no-cache");
          res.header("X-Permission", attachmentData.meta.perm);
          res.header(
            "Last-Modified",
            lastModifiedHeader,
          );
          res.header("Content-Type", attachmentData.meta.contentType);
          res.send(Buffer.from(attachmentData.data));
        } catch {
          // console.error("Error in main router", e);
          res.status(404);
          res.end();
        }
      })
      .put(
        bodyParser.raw({ type: "*/*", limit: "100mb" }),
        async (req, res) => {
          const name = req.params[0];
          console.log("Saving file", name);

          try {
            const meta = await spacePrimitives.writeFile(
              name,
              new Uint8Array(req.body as ArrayBuffer),
            );
            res.status(200);
            res.header("Content-Type", meta.contentType);
            res.header("X-Last-Modified", "" + meta.lastModified);
            res.header("X-Content-Length", "" + meta.size);
            res.header("X-Permission", meta.perm);
            res.send("OK");
          } catch (err) {
            res.status(500);
            res.send("Write failed");
            console.error("Pipeline failed", err);
          }
        },
      )
      .options(async (req, res) => {
        const name = req.params[0];
        try {
          const meta = await spacePrimitives.getFileMeta(name);
          res.status(200);
          res.header("Content-Type", meta.contentType);
          res.header("X-Last-Modified", "" + meta.lastModified);
          res.header("X-Content-Length", "" + meta.size);
          res.header("X-Permission", meta.perm);
        } catch {
          res.status(404);
          res.send("Not found");
          // console.error("Options failed", err);
        }
      })
      .delete(async (req, res) => {
        const name = req.params[0];
        console.log("Deleting file", name);
        try {
          await spacePrimitives.deleteFile(name);
          res.status(200);
          res.send("OK");
        } catch (e: any) {
          console.error("Error deleting attachment", e);
          res.status(200);
          res.send(e.message);
        }
      });
    return fsRouter;
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      console.log("stopped server");
    }
  }
}

function utcDateString(mtime: number): string {
  return new Date(mtime).toUTCString();
}
