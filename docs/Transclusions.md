---
description: Inline embedding of one page's content inside another.
tags: glossary
references:
- plug-api/lib/transclusion.ts
- client/markdown_renderer/markdown_render.ts
---

Transclusions are an extension of the [[Markdown]] syntax enabling inline embedding of content.

The general syntax is `![[path]]`. Two types of transclusions are currently supported:

# Media
Syntax: `![[path/to/image.jpg]]`; see [[Document#Embedding]] for more details.

Transclusions already support images, audio, video, and PDFs using the browser's corresponding media elements. Local media is served through range-capable `/.fs` responses, so playback seeking and incremental PDF loading use the same server and service-worker behavior as full-document media viewing.

Media resizing is also supported:
![[Document#Media resizing]]
# Pages
Syntax:
* `![[page name]]` embed an entire page
* `![[page name#header]]` embed only a section (guarded by the given header)

Text and source documents are not transcluded as highlighted source. The editable text-document fallback does not change this boundary: page transclusion remains limited to Markdown pages.
