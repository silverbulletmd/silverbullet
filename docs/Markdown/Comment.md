---
description: Block-level HTML comments, whose body is ordinary markdown.
references:
- client/markdown_parser/html_block.ts
- client/codemirror/comment_region.ts
- plugs/index/indexer.ts
---
An HTML comment is a region of a page that other markdown renderers ignore — GitHub, Obsidian, a plain viewer — but that SilverBullet treats as ordinary content, in the sense that it renders it like any other markdown text and [[Concept/Object Index|object indexes]] as well, albeit with an `inComment: true` attribute set so that it is easy to filter in queries.

Example:

<!--
This is a comment. Its body is *real* markdown.
-->

Inside SilverBullet the `<!--` and `-->` markers are hidden and the region gets a tint of its own, labelled `comment` in its top right corner. The “Resolve” button can be used to dismiss (= delete) the comment in its entirity.

# Use cases
Comments can be used to make notes to self or to team mates about the regular page content. There may be other future use cases as well.

# Commands
* `Comment: Add` (`Ctrl-Alt-c` / `Cmd-Alt-c`, or the `/comment` slash command) inserts a comment after the current block.
* `Comment: Selection` wraps the selected lines in `<!--` and `-->`.

# Querying
Everything indexed inside a comment carries `inComment = true`, so a commented-out task is still a task — it simply says so:

    <!--
    * [ ] Buy milk
    -->

Queries do **not** filter these out. Exclude them explicitly when you want only live content:

```lua
${from t = index.tasks() where not t.inComment}
```

# Scripts stay off
A `space-lua` or `space-style` block inside a comment is _not_ indexed, and the pages read at boot ([[CONFIG]], [[Concept/Library|libraries]]) skip it as well, so commenting a script out is how you disable it.

What a comment does not switch off is live evaluation in the open editor: `${...}` [[Space Lua#Expressions|expressions]] and Lua-registered [[API/codeWidget|code widgets]] inside a comment still run and render, and a commented-out `space-lua` block is still linted for syntax errors.
