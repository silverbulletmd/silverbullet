---
references:
- client/document_editor.ts
- client/document_editor_js.ts
- client/document_editor_resolver.ts
---
Document-editor plugs display non-Markdown files in an iframe. For ordinary file handling and built-in fallbacks, see [[Document Editor]].

# Resolution
SilverBullet tries an installed editor declaring the file extension first, then a browser-supported safe media viewer, then the text editor for recognized text or small unknown valid UTF-8 files, then external opening. An installed plug takes precedence over the built-in fallbacks.

# Defining an editor
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

To communicate with SilverBullet, events and messages are used. You can subscribe to an event inside a script tag as follows:

```javascript
window.silverbullet.addEventListener("file-open", (event) => {
  const { data, meta, details } = event.detail;
  console.log("Opened:", meta.name, data, details);
});
```

SilverBullet will dispatch the following events:
- `file-open`: A file was just navigated to, the document editor needs to open it. `event.detail` is `{ data: Uint8Array, meta: DocumentMeta, details }`, where `details` carries an optional position or other navigation target.
- `request-save`: SilverBullet is requesting a save, you should send a `file-saved` event as soon as possible
- `focus`: You should focus the editor if possible (i.e. highlight cursor). If you don’t know how to handle this `window.focus()` is a good bet.

To send events/messages like the `file-saved` message, you can use the `sendMessage` function.

```javascript
window.silverbullet.sendMessage("file-saved", { data: new TextEncoder().encode("We saved a text file") })
```

If the document changed and a save is necessary, you can send the `file-changed` message. SilverBullet will request a save automatically.
You can also send events from the outside using the `editor.sendMessage` syscall. If you want to communicate the other way around you can call syscalls using `window.silverbullet.syscall(name: string, ...args: any[])`.
