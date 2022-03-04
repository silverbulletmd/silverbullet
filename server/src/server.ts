import cors from "cors";
import express from "express";
import fs from "fs";
import { readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import stream from "stream";
import {} from "stream/promises";
import { promisify } from "util";

const app = express();
const port = 3000;
const pipeline = promisify(stream.pipeline);
const pagesPath = "../pages";
const distDir = `${__dirname}/../../webapp/dist`;

type PageMeta = {
  name: string;
  lastModified: number;
};

app.use("/", express.static(distDir));

let fsRouter = express.Router();

// Page list
fsRouter.route("/").get(async (req, res) => {
  const localPath = pagesPath;
  let fileNames: PageMeta[] = [];

  async function walkPath(dir: string) {
    let files = await readdir(dir);
    for (let file of files) {
      const fullPath = path.join(dir, file);
      let s = await stat(fullPath);
      if (s.isDirectory()) {
        await walkPath(fullPath);
      } else {
        if (path.extname(file) === ".md") {
          fileNames.push({
            name: fullPath.substring(pagesPath.length + 1, fullPath.length - 3),
            lastModified: s.mtime.getTime(),
          });
        }
      }
    }
  }
  await walkPath(pagesPath);
  res.json(fileNames);
});

fsRouter
  .route(/\/(.+)/)
  .get(async (req, res) => {
    let reqPath = req.params[0];
    console.log("Getting", reqPath);
    try {
      const localPath = path.join(pagesPath, reqPath + ".md");
      const s = await stat(localPath);
      let content = await readFile(localPath, "utf8");
      res.status(200);
      res.header("Last-Modified", "" + s.mtime.getTime());
      res.header("Content-Type", "text/markdown");
      res.send(content);
    } catch (e) {
      res.status(200);
      res.send("");
    }
  })
  .put(async (req, res) => {
    let reqPath = req.params[0];

    let localPath = path.join(pagesPath, reqPath + ".md");

    try {
      await pipeline(req, fs.createWriteStream(localPath));
      console.log(`Wrote to ${localPath}`);
      const s = await stat(localPath);
      res.status(200);
      res.header("Last-Modified", "" + s.mtime.getTime());
      res.send("OK");
    } catch (err) {
      res.status(500);
      res.send("Write failed");
      console.error("Pipeline failed", err);
    }
  })
  .options(async (req, res) => {
    let reqPath = req.params[0];
    try {
      const localPath = path.join(pagesPath, reqPath + ".md");
      const s = await stat(localPath);
      res.status(200);
      res.header("Last-Modified", "" + s.mtime.getTime());
      res.header("Content-length", "" + s.size);
      res.header("Content-Type", "text/markdown");
      res.send("");
    } catch (e) {
      res.status(200);
      res.send("");
    }
  })
  .delete(async (req, res) => {
    let reqPath = req.params[0];
    const localPath = path.join(pagesPath, reqPath + ".md");
    try {
      await unlink(localPath);
      res.status(200);
      res.send("OK");
    } catch (e) {
      console.error("Error deleting file", localPath, e);
      res.status(500);
      res.send("OK");
    }
  });

app.use(
  "/fs",
  cors({
    methods: "GET,HEAD,PUT,OPTIONS,POST,DELETE",
    preflightContinue: true,
  }),
  fsRouter
);

// Fallback, serve index.html
let cachedIndex: string | undefined = undefined;
app.get("/*", async (req, res) => {
  if (!cachedIndex) {
    cachedIndex = await readFile(`${distDir}/index.html`, "utf8");
  }
  res.status(200).header("Content-Type", "text/html").send(cachedIndex);
});

app.listen(port, () => {
  console.log(`Server istening on port ${port}`);
});
