---
description: A note-to-self or @-addressed HTML-comment thread attached to a piece of text, indexed as a queryable object.
tags: glossary maturity/experimental
references:
- plug-api/lib/comments.ts
- plugs/index/comment.ts
- plugs/editor/comments.ts
- client/codemirror/comment_widget.ts
---
Comments let you — and, when you want, your collaborators — leave notes inside a page without touching the rendered content. They are plain [[Markdown]] HTML comments under the hood, so the convention works everywhere and are technically valid markdown.

# Grammar
Any HTML comment is considered a note unless it’s a [[Baked Sections]] marker. The simplest example is just bare text (Alt-click to see the underlying code):

<!-- remember this -->

Sign a note to record when, and optionally who wrote it with the `— author, date` suffix. The separator may be `-`, `--`, `–` or `—` when hand-typed:

<!-- rephrase this later — pete, 2026-08-05 -->

An optional **first line** `re: "quoted anchor"` anchors the note to a snippet of the surrounding text (straight or curly quotes both work). It shows up as the quoted context in the card:

<!-- re: "the surrounding text"
Commenting on a specific phrase — 2026-08-05
-->

Addressing a note to someone turns it into a routing mechanism (that can be used for querying):

<!-- re: "making a claim"
@pete: verify this — john, 2026-08-04
@john:  — 2026-08-06
-->

* **`@who:`** addresses a message to `who`.
* **Replies** are just more lines in the same block, each addressed to whoever should answer next. A reply can itself be unaddressed, if there’s no one left to hand it to.
* **Resolving** a thread means deletes the comment block altogether. There's no separate "resolved" state to track — gone is resolved.

A full back-and-forth looks like:

<!-- re: "the retry logic"
@pete: should this back off exponentially? — john, 2026-08-04
@john: yes, capped at 30s, — pete, 2026-08-05
-->

# Widget
A conforming comment block renders as a card: the quoted (`re:`) text (if any) with an `@addressee` when the message is addressed, or just its text when it is not. A _Reply_ button appears when comments are addressed with `@addressee`, the button appends a new line addressed to whoever should answer next (inferred from the last message). The _Resolve_ button simply removes the comment entirely.

# Commands
* `Comment: Add` (`Ctrl-Alt-c`/`Cmd-Alt-c`) inserts a new comment block after the current paragraph. With an active selection, the selected text becomes the `re: "..."` quote.
* Slash command: `/comment` inserts a comment.

# Configuration
* `comments.author`: your signature identity. Set it so messages you write get signed automatically. Also editable from the Configuration Manager's Comments category.

```lua
config.set("comments.author", "pete")
```

Leaving `comments.author` unset is fine — comments you add just carry a date-only signature instead of a named one.

# Query
Every conforming comment is indexed as an object tagged `comment`, queryable like any other [[Object]] via [[Space Lua/Integrated Query]]. `index.comments()` is the idiomatic named collection:

* `page`: the page the comment lives on
* `range`: `[from, to]` character offsets of the comment block
* `quote?`: the anchored text, if the block had a `re: "..."` line
* `thread`: the list of messages, each `{ addressee?, text, author?, date? }`
* `addressees`: the distinct set of everyone addressed in the thread (empty for a purely unaddressed note)
* `waitingOn?`: the addressee of the *last* message, if it's addressed — whose turn it is to respond. Absent for a note with no addressee.
* `lastDate?`: the date of the last signed message, if any

Example:
${query[[
  from c = index.comments()
  select table.select(c, "ref", "thread")
]]}

