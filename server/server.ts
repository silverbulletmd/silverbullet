import * as path from "https://deno.land/std@0.125.0/path/mod.ts";
import FileInfo = Deno.FileInfo;

import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.0/mod.ts";
import { readAll } from "https://deno.land/std@0.126.0/streams/mod.ts";


const fsPrefix = '/fs';
const notesPath = '../notes';

const fsRouter = new Router();

fsRouter.use(oakCors());

fsRouter.get('/', async context => {
    const localPath = notesPath;
    let fileNames: string[] = [];
    for await (const dirEntry of Deno.readDir(localPath)) {
        if (dirEntry.isFile) {
            fileNames.push(dirEntry.name.substring(0, dirEntry.name.length - path.extname(dirEntry.name).length));
        }
    }
    context.response.body = JSON.stringify(fileNames);
});

fsRouter.get('/:note', async context => {
    const noteName = context.params.note;
    const localPath = `${notesPath}/${noteName}.md`;
    const text = await Deno.readTextFile(localPath);
    context.response.body = text;
});

fsRouter.options('/:note', async context => {
    const localPath = `${notesPath}/${context.params.note}.md`;
    const stat = await Deno.stat(localPath);
    context.response.headers.set('Content-length', `${stat.size}`);
})

fsRouter.put('/:note', async context => {
    const noteName = context.params.note;

    const localPath = `${notesPath}/${noteName}.md`;
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
    console.log("Wrote to", localPath)
    context.response.body = "OK";
});

const app = new Application();
app.use(new Router().use(fsPrefix, fsRouter.routes(), fsRouter.allowedMethods()).routes());
app.use(async (context, next) => {
    try {
        await context.send({
            root: '../webapp/dist',
            index: 'index.html'
        });
    } catch {
        next();
    }
});

await app.listen({ port: 2222 });
