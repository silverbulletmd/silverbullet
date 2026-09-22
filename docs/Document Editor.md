---
references:
- client/document_editor.ts
- client/document_editor_resolver.ts
- client/text_document_editor.ts
- client/media_document_viewer.ts
---
Document editors let you view or edit files other than Markdown pages. SilverBullet first gives installed [[Plugs|plugs]] a chance to handle a document by file extension, then falls back to its built-in browser media viewer or text editor. If none can safely handle the file, SilverBullet opens it externally.

# Usage
Open the document picker using ${widgets.commandButton("Navigate: Document Picker")}, which works similarly to the page picker. The file tree can be used as well.

SilverBullet resolves a document in this order:

1. An installed document-editor plug that declares the file extension.
2. A built-in browser media viewer for a safe image, audio, video, or PDF type supported by the current browser.
3. The built-in text editor for a known source extension, a textual content type, or a small unknown file that is valid UTF-8.
4. The existing external-open behavior.

An installed plug always wins. In particular, the built-in image-viewer plug continues to handle its declared image extensions and provides its specialized pan, zoom, and rotation controls.

## Editing text documents
Text documents up to 5 MiB are edited in the same CodeMirror editor used for pages. Known formats such as Rust, JavaScript, JSON, HTML, XML, and LaTeX receive syntax highlighting from SilverBullet’s existing language support. Other valid UTF-8 files open as plain text.

## Viewing media documents
Safe images can use the built-in browser image fallback when no plug claims their extension. Audio and video open with native controls only when the browser reports support for their content type.

# Available editors
Optional document-editor plugs can replace the built-in fallback for their declared extensions. These editors are installable through the [[Configuration Manager#Libraries|Library Manager]].

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

To communicate with SilverBullet, events and messages are used. You can subscribe to an event inside a script tag as follows:

```javascript
window.silverbullet.addEventLister("file-open", (event) => {
  console.log("Got an event:", event);
});
```

SilverBullet will dispatch the following events:
- `file-open`: A file was just navigated to, the document editor needs to open it. The details contain the meta and data: `{ data: Uint8Array, meta: DocumentMeta }`
- `request-save`: Silverbullet is requesting a save, you should send a `file-saved` event as soon as possible
- `focus`: You should focus the editor if possible (i.e. highlight cursor). If you don't know how to handle this `window.focus()` is a good bet.

To send events/messages like the `file-saved` message, you can use the `sendMessage` function.

```javascript
window.silverbullet.sendMessage("file-saved", { data: new TextEncoder().encode("We saved a text file") })
```

If the document changed and a save is necessary, you can send the `file-changed` message. SilverBullet will request a save automatically.
You can also send events from the outside using the `editor.sendMessage` syscall. If you want to communicate the other way around you can call syscalls using `window.silverbullet.syscall(name: string, ...args: any[])`.
