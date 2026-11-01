---
references:
- client/document_editor.ts
- client/document_editor_resolver.ts
- client/text_document_editor.ts
- client/media_document_viewer.ts
---
Document editors let you view or edit files other than Markdown pages.

# Usage
Open a file from the [[File Tree]] or run ${widgets.commandButton("Navigate: Document Picker")}. SilverBullet uses an installed editor for its file type when available; otherwise it uses the built-in media viewer or text editor, or opens the file externally. Available media formats depend on your browser.

## Editing text documents
Text documents up to 5 MiB use the same CodeMirror editor as pages. Known formats such as Rust, JavaScript, JSON, HTML, XML and LaTeX receive syntax highlighting; other valid UTF-8 files open as plain text.

## Viewing media documents
The built-in browser fallback displays safe images, audio, video and PDFs supported by the browser. An installed image-viewer plug provides its own pan, zoom and rotation controls for its declared extensions.

# Available editors
Optional document-editor plugs are installed through the [[Workbench/Libraries|Library Manager]]:

* [PDF viewer](https://github.com/MrMugame/silverbullet-pdf/)
* [Excalidraw](https://github.com/LogeshG5/silverbullet-excalidraw)

# Development
For plug manifests, resolution rules, iframe messaging and save handling, see [[Plugs/Development/Document Editors]].
