---
description: A non-page file (such as an image, PDF, or other attachment) stored in your space.
tags: glossary
---
While SilverBullet is aimed primarily at text-based content, documents let a space contain source files, images, PDFs, audio, video, and other attachments. Documents, like [[Page|pages]], are ultimately just files on disk. Installed plugs can provide specialized editors, while built-in fallbacks edit UTF-8 text and display browser-supported media.

# Uploading
To create a document, you have a few options:

* Use the ${widgets.commandButton("Upload: File")} command (especially useful on mobile devices)
* Drag & drop files or images onto a page
* Copy & paste files or images onto a page

All options will prompt you for a file name to use to store the document, and then include the document as an embedded image (if it was an image) or link to the file.

# Management
Using ${widgets.commandButton("Navigate: Document Picker")} you can open the document picker, which displays all documents in your SilverBullet space. A blue extension indicates that an installed plug, the built-in text editor, or a browser media viewer can handle the document; gray indicates that the file opens externally. Unknown small files may still require a UTF-8 check when opened.

The built-in text editor accepts valid UTF-8 documents up to 5 MiB, with syntax highlighting for known source formats and plain text for other formats. In the host fallback, HTML, SVG, XML, JavaScript, and similar active content is edited as source rather than executed; the specialized image-viewer plug claims SVG first. Browser-supported images, audio, video, and PDFs can be viewed in the editor; media that the current browser cannot display opens externally.

# Linking
Documents can be linked to in two ways:
* Via the regular link syntax: `[link text](document.pdf)`. URLs here are relative to the page, so on a page named `MyFolder/Hello`, `[link text](document.pdf)` would refer to a document stored in `MyFolder/document.pdf`.
* Via the wiki link syntax: `[[document.pdf]]`. These paths are absolute and relative to your space’s root, just like regular page links. That is: on a page `MyFolder/Hello` a document link `[[document.pdf]]` would link to the file `document.pdf` in the space’s root folder.

# Embedding
Media can also be embedded using the [[#Linking]] syntax, but prefixed with an `!`. Images, video, audio, and PDFs are supported using the browser's native media elements and range-capable file responses.

* `![alternate text](image.png)`
* `![[image.png]]`

These follow the same relative/absolute path rules as links described before.

## Media resizing
In addition, media can be _sized_ using the following syntax:
* Specifying only a width: `![Alt text|300](image.png)` or `![[image.png|300]]`
* Specifying only a height: `![Alt text|x300](image.png)` or `![[image.png|x300]]`
* Specifying both width and height: `![Hello|300x300](image.png)` or `![[image.png|300x300]]`
