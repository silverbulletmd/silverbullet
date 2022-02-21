export class HttpFileSystem {
    constructor(url) {
        this.url = url;
    }
    async listNotes() {
        let req = await fetch(this.url, {
            method: 'GET'
        });
        return (await req.json()).map((name) => ({ name }));
    }
    async readNote(name) {
        let req = await fetch(`${this.url}/${name}`, {
            method: 'GET'
        });
        return await req.text();
    }
    async writeNote(name, text) {
        let req = await fetch(`${this.url}/${name}`, {
            method: 'PUT',
            body: text
        });
        await req.text();
    }
}
