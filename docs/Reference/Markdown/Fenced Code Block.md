---
description: "A fenced block for source code, widgets or executable Space Lua."
tags: glossary
references:
- client/codemirror/syntax/fenced_code.ts
- client/markdown_parser/parser.ts
---
Blocks use the fenced code block notation of [[Reference/Markdown]], and assign special behavior to it.

The general syntax is:

    ```language
    block configuration
    ```

These are the block types that ship with SilverBullet, but [[Reference/Internals/Plugs]] can define their own:

* `space-lua`: [[Reference/Space Lua]]
* `space-style`: [[Reference/Theming/Space Style]]

The fenced code block syntax is also used to get [[Markdown/Syntax Highlighting]] for numerous programming languages.
