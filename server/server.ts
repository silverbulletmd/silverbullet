import * as path from "https://deno.land/std@0.125.0/path/mod.ts";
import FileInfo = Deno.FileInfo;

import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.0/mod.ts";
import { readAll } from "https://deno.land/std@0.126.0/streams/mod.ts";
import { exists } from "https://deno.land/std@0.126.0/fs/mod.ts";

type NuggetMeta = {
  name: string;
  lastModified: number;
};

const fsPrefix = "/fs";
const nuggetsPath = "../pages";

const fsRouter = new Router();

fsRouter.use(oakCors({ methods: ["OPTIONS", "GET", "PUT", "POST"] }));

fsRouter.get("/", async (context) => {
  const localPath = nuggetsPath;
  let fileNames: NuggetMeta[] = [];
  for await (const dirEntry of Deno.readDir(localPath)) {
    if (dirEntry.isFile) {
      const stat = await Deno.stat(`${localPath}/${dirEntry.name}`);
      fileNames.push({
        name: dirEntry.name.substring(
          0,
          dirEntry.name.length - path.extname(dirEntry.name).length
        ),
        lastModified: stat.mtime?.getTime()!,
      });
    }
  }
  context.response.body = JSON.stringify(fileNames);
});

fsRouter.get("/:nugget", async (context) => {
  const nuggetName = context.params.nugget;
  const localPath = `${nuggetsPath}/${nuggetName}.md`;
  try {
    const stat = await Deno.stat(localPath);
    const text = await Deno.readTextFile(localPath);
    context.response.headers.set("Last-Modified", "" + stat.mtime?.getTime());
    context.response.body = text;
  } catch (e) {
    context.response.status = 404;
    context.response.body = "";
  }
});

fsRouter.options("/:nugget", async (context) => {
  const localPath = `${nuggetsPath}/${context.params.nugget}.md`;
  try {
    const stat = await Deno.stat(localPath);
    context.response.headers.set("Content-length", `${stat.size}`);
    context.response.headers.set("Last-Modified", "" + stat.mtime?.getTime());
  } catch (e) {
    // For CORS
    context.response.status = 200;
    context.response.body = "";
  }
});

fsRouter.put("/:nugget", async (context) => {
  const nuggetName = context.params.nugget;
  const localPath = `${nuggetsPath}/${nuggetName}.md`;
  const existingNugget = await exists(localPath);
  let file;
  try {
    file = await Deno.create(localPath);
  } catch (e) {
    console.error("Error opening file for writing", localPath, e);
    context.response.status = 500;
    context.response.body = e.message;
    return;
  }
  const result = context.request.body({ type: "reader" });
  const text = await readAll(result.value);
  file.write(text);
  file.close();
  const stat = await Deno.stat(localPath);
  console.log("Wrote to", localPath);
  context.response.status = existingNugget ? 200 : 201;
  context.response.headers.set("Last-Modified", "" + stat.mtime?.getTime());
  context.response.body = "OK";
});

const app = new Application();
app.use(
  new Router()
    .use(fsPrefix, fsRouter.routes(), fsRouter.allowedMethods())
    .routes()
);
app.use(async (context, next) => {
  try {
    await context.send({
      root: "../webapp/dist",
      index: "index.html",
    });
  } catch {
    next();
  }
});

await app.listen({ port: 2222 });
