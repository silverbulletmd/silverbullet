Document editors allow you to not only view but also edit files other than markdown. By itself they are just [[Plugs|plugs]] which hook into Silverbullet and provide an editor based on the extension of the file. Silverbullet includes an image viewer by itself to view most image files (`jpg`, `png`, ...). If you are missing an editor and want to build your own look at [[#Development]].

# Usage
To get started, you first need to install a plug that provides a document editor (for examples see [[#Available editors]]). Once installed and loaded, you can open the document navigator using `Cmd-o` (Mac) or `Ctrl-o` (Windows, Linux), which works similarly to the page navigator. The only difference is that files which you can open will have their extension highlighted in blue, files for which no document editor is loaded are gray.

# Available editors
Currently only two major document editors exist (As well as the built-in image viewer). Both are installable through the [[Library Manager]].

- [PDF viewer](https://github.com/MrMugame/silverbullet-pdf/)
- [Excalidraw](https://github.com/LogeshG5/silverbullet-excalidraw)

# Development
First the editor is defined inside the plug manifest. The `editor` field is used to specify the file extensions your editor can handle.

```yaml
name: txteditor
functions:
  TXTEditor:
    path: ./editor.ts:editor
    editor: ["txt"]
```

The function provided should look like this. The html tag will be directly inserted into an iframe as the `srcdoc`. This means you can also use the `<head>` or `<body>` tags.

```typescript
export async function editor(): Promise<{ html: string }> {
  return {
    html: "<h1>Document Editor example</h1>"
  }
}
```

To communicate with silverbullet events/messages are used. You can subscribe to an event inside a script tag as follows

```javascript
window.silverbullet.addEventLister("file-open", (event) => {
  console.log("Got an event:", event);
});
```

SB will dispatch the following events:
- `file-open`: A file was just navigated to, the document editor needs to open it. The details contain the meta and data: `{ data: Uint8Array, meta: DocumentMeta }`
- `request-save`: Silverbullet is requesting a save, you should send a `file-saved` event as soon as possible
- `focus`: You should focus the editor if possible (i.e. highlight cursor). If you don't know how to handle this `window.focus()` is a good bet.

To send events/messages like the `file-saved` message, you can use the `sendMessage` function.

```javascript
window.silverbullet.sendMessage("file-saved", { data: new TextEncoder().encode("We saved a text file") })
```

If a the document changed and a save is necessary you can send the `file-changed` message. Silverbullet will request a save automatically.
You can also send events from the outside using the `editor.sendMessage` syscall. If you want to communicate the other way around you can call syscalls using `window.silverbullet.syscall(name: string, ...args: any[])`.
