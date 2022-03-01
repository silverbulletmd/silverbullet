import * as path from "https://deno.land/std@0.125.0/path/mod.ts";
import FileInfo = Deno.FileInfo;

import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.0/mod.ts";
import { readAll } from "https://deno.land/std@0.126.0/streams/mod.ts";
import { exists } from "https://deno.land/std@0.126.0/fs/mod.ts";

import { recursiveReaddir } from "https://deno.land/x/recursive_readdir@v2.0.0/mod.ts";

type PageMeta = {
  name: string;
  lastModified: number;
};

const fsPrefix = "/fs";
const pagesPath = "../pages";

const fsRouter = new Router();

fsRouter.use(oakCors({ methods: ["OPTIONS", "GET", "PUT", "POST", "DELETE"] }));

fsRouter.get("/", async (context) => {
  const localPath = pagesPath;
  let fileNames: PageMeta[] = [];
  const markdownFiles = (await recursiveReaddir(localPath)).filter(
    (file: string) => path.extname(file) === ".md"
  );
  for (const p of markdownFiles) {
    const stat = await Deno.stat(p);
    fileNames.push({
      name: p.substring(
        localPath.length + 1,
        p.length - path.extname(p).length
      ),
      lastModified: stat.mtime?.getTime()!,
    });
  }
  context.response.body = JSON.stringify(fileNames);
});

fsRouter.get("/:page(.*)", async (context) => {
  const pageName = context.params.page;
  const localPath = `${pagesPath}/${pageName}.md`;
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

fsRouter.options("/:page(.*)", async (context) => {
  const localPath = `${pagesPath}/${context.params.page}.md`;
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

fsRouter.put("/:page(.*)", async (context) => {
  const pageName = context.params.page;
  const localPath = `${pagesPath}/${pageName}.md`;
  const existingPage = await exists(localPath);
  let dirName = path.dirname(localPath);
  if (!(await exists(dirName))) {
    await Deno.mkdir(dirName, {
      recursive: true,
    });
  }
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
  console.log("Wrote to", localPath);
  const stat = await Deno.stat(localPath);
  context.response.status = existingPage ? 200 : 201;
  context.response.headers.set("Last-Modified", "" + stat.mtime?.getTime());
  context.response.body = "OK";
});

fsRouter.delete("/:page(.*)", async (context) => {
  const pageName = context.params.page;
  const localPath = `${pagesPath}/${pageName}.md`;
  try {
    await Deno.remove(localPath);
  } catch (e) {
    console.error("Error deleting file", localPath, e);
    context.response.status = 500;
    context.response.body = e.message;
    return;
  }
  console.log("Deleted", localPath);

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
    await context.send({ root: "../webapp/dist", path: "index.html" });
    // next();
  }
});

await app.listen({ port: 2222 });
