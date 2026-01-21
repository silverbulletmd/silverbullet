Document editors allow users to not only view but also edit documents. This means that Silverbullet can (theoretically) be used for much more than just markdown, e.g. PDF, asciidoc, org and a lot more. Currently the feature is still very young and the only editors available are proof of concepts, but this should hopefully change soon. If you want to contribute and make your own editor look at [[#Internals]]

# Usage
Document editors are provided by [[Plugs]]. To install a document editor just install the plug. The editor will then be available for documents with certain file extensions which are specified by the plug, e.g. an image viewer would be available for `jpg`, `jpeg` and `png`.
To edit or view a document, use `Cmd-o` (Mac) or `Ctrl-o` (Windows, Linux) to open the document navigator. Files for which a document editor is available will have their extension highlighted in blue.

# Available editors
Currently only small demos are available
- [TXT editor](https://github.com/MrMugame/silverbullet-txt/)
- [PDF viewer](https://github.com/MrMugame/silverbullet-pdf/)

# Development
First the editor is defined inside the plug manifest. The `editor` field is used to specify the file extensions this editor can handle.

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
- `focus`: You should focus the editor if possible (i.e. highlight cursor)

To send events/messages like the `file-saved` message, you can use the `sendMessage` function.

```javascript
window.silverbullet.sendMessage("file-saved", { data: new TextEncoder().encode("We saved a text file") })
```

If a the document changed and a save is necessary you can send the `file-changed` message. Silverbullet will request a save automatically.
You can also send events from the outside using the `editor.sendMessage` syscall. If you want to communicate the other way around you can call syscalls using `window.silverbullet.syscall(name: string, ...args: any[])`.
