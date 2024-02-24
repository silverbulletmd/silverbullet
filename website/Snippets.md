Snippets allow you to define custom [[Commands]] and [[Slash Commands]] that expand snippet-style templates inline.

# Definition
You define a snippet by creating a [[Templates|template]] with a `hooks.snippet` attribute that configures the snippet. The following configuration options are supported:

* `slashCommand`: expose the snippet via the `/my-snippet` notation.
* `order`: when completing as a slash commend, use this to order suggestions (higher is lower down the list)
* `command`: expose the snippet as a [[Commands|command]].
* `key`: Bind the snippet to a keyboard shortcut (note: this requires to _also_ specify the `command` configuration).
* `mac`: Bind the snippet to a Mac-specific keyboard shortcut.
* `matchRegex` (advanced use only): match the _current line_ against a regular expression, and replace the match with the template’s body. If a caret placeholder (`|^|`) appears in the template’s body, the replacement body _before_ the caret will be the replacement of the matchRegex match, and the part _after_ that carret will be appended to the end of the line. This enables text wrapping behavior, see the example below.
* `insertAt`: by default a snippet is inserted at the cursor position, but alternatively it can be inserted at: `line-start`, `line-end`, `page-start` or `page-end`.

# Frontmatter
A template’s [[Frontmatter]] is interpreted by SilverBullet’s [[Templates|template]] engine and removed when instantiated. However, to inject frontmatter after instantiation, you can use the `frontmatter` attribute.

Example:

```
---
tags: template
hooks.snippet.slashCommand: meeting-notes
frontmatter: |
   date: {{today}}
---
## Meeting notes for {{today}}!

|^|
```

Which will expand into e.g.

```
---
date: 2023-11-11
---
## Meeting notes for 2023-11-11

.
```

When the page already contained frontmatter before inserting the snippet, it will be augmented with the additional frontmatter specified by the template.

# Examples
A minimal example using a caret placeholder (to position the cursor after snippet insertion):

```
---
tags: template
hooks.snippet.slashCommand: meeting-notes
---
## Meeting notes for {{today}}!

|^|
```

A more advanced example using `matchRegex`: a variant of the [[Library/Core/Snippet/Task]] template which adds a `creationDate` [[Attributes|attribute]] at the end:

```
---
tags: template
description: Make this a task with a creation date
hooks.snippet:
  slashCommand: task-created
  matchRegex: "^(\\s*)[\\-\\*]?\\s*(\\[[ xX]\\])?\\s*"
---
$1* [ ] |^| [creationDate: {{today}}]
```

# Use
A snippet can be _triggered_ via the specified `slashCommand` via `/slashCommand` or via {[Open Command Palette]} and/or its associate key bindings when `command`, `key`/`mac` are specified.
