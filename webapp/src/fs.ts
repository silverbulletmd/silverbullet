
import { NoteMeta } from "./types";


export interface FileSystem {
    listNotes(): Promise<NoteMeta[]>;
    readNote(name: string): Promise<string>;
    writeNote(name: string, text: string): Promise<void>;
}

export class HttpFileSystem implements FileSystem {
    url: string;

    constructor(url: string) {
        this.url = url;
    }
    async listNotes(): Promise<NoteMeta[]> {
        let req = await fetch(this.url, {
            method: 'GET'
        });

        return (await req.json()).map((name: string) => ({ name }));
    }
    async readNote(name: string): Promise<string> {
        let req = await fetch(`${this.url}/${name}`, {
            method: 'GET'
        });
        return await req.text();
    }
    async writeNote(name: string, text: string): Promise<void> {
        let req = await fetch(`${this.url}/${name}`, {
            method: 'PUT',
            body: text
        });
        await req.text();
    }
}