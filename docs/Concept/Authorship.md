---
description: Sign a block or a page to credit who wrote it, distinct from who it addresses.
tags: glossary maturity/experimental
references:
- client/markdown_parser/parser.ts
- plugs/index/relation.ts
- plugs/index/identity.ts
- libraries/Library/Std/Editor/Signature.md
- docs/Recipient.md
---
An **author** is an [[Concept/Identity]] you credit. A signature is an [[Concept/At-Mention]] used the other way around: an `@mention` **addresses** someone, while a signature **credits** someone. The same identities serve both — anyone you can mention, you can also sign as, including yourself.

# The `-- @name` notation
End a block with `-- @name` — or the em dash `— @name`, or the en dash `– @name` — to sign it.

Rules:
* The marker has to **terminate its block**. `-- @zef` in the middle of a paragraph is not a signature.
* Several names can sign together: `-- @ada @zef` credits both.

# What signing does
A signature is not a [[Concept/Recipient]] [[Concept/At-Mention]]. It does not enter somebody’s Mention Inbox. Instead, it **attributes** the block it ends: every `@mention` inside that block is stamped with a `by` value naming who signed it, and the signature emits its own `authored` relation.

“The block it ends” is usually the enclosing paragraph, list item, task, blockquote, or HTML comment. When a signature stands alone on its own line, it applies to the surrounding comment, list item, or blockquote instead of claiming just the empty-looking line it sits on, so the whole exchange above it is credited, not only the last line.

# `authors:` frontmatter
Declaring `authors:` in a page's frontmatter credits the whole page, the same way `recipients:` addresses the whole page:

```yaml
---
authors: ["ada", "zef"]
---
```

A wiki-link value in `authors:`, like `[[ada]]`, is not a name and is silently ignored — unlike `recipients:`, which keeps a wiki link as an ordinary page link.

This does **not** cascade down to unsigned blocks in the page body: an `@mention` written elsewhere on the page without its own `-- @name` stays unattributed. Frontmatter `authors:` is page-level credit only — crediting a specific block still needs an inline signature on that block.

# Signing your own text
Rather than typing the notation by hand, run `Mention: Sign` (or the `/sign` slash command) to append `-- @you` to the end of the current block. This is what lets a person — or an agent — answer a mention without re-queuing the reply in their own inbox: signing a reply attributes it, it does not address it, so it never becomes a fresh request to yourself.

# A signature is self-declared, not authenticated
Nothing checks a signature against who is actually editing. Anyone with write access can type `-- @zef` whether or not they are Zef — SilverBullet takes it at face value, the same way it takes an `@mention` at face value. If you need to know who **actually** changed something, that's what [[Feature/Revisions|commit attribution]] is for: it's held server-side and derived from the account that made the change, not from text anyone can type.

A signature is documentary, not a credential — useful for finding and querying who a piece of prose is by, but nothing security- or access-relevant should ever be decided based on one.
