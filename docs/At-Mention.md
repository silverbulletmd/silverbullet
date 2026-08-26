---
description: The `@name` span in text, refers to an identity and points either way — addressed or credited.
tags: glossary maturity/experimental
references:
- client/markdown_parser/parser.ts
- plugs/index/relation.ts
- client/codemirror/at_mention.ts
---
An **at-mention** is the `@name` span you type in text. It refers to an [[Identity]], and it has two directions: written plainly it *addresses* that identity, making it a [[Recipient]], or when used as a signature it *credits* that identity instead, see [[Authorship]].

# `@name` syntax
Type `@` followed by a name with no spaces, e.g. @ada. While typing, autocomplete offers every known identity.

A name may contain dots, so dotted usernames carry whole: @pete.smith and @ada.b.lovelace are each one mention.

**Any name is a valid mention.** Nothing needs declaring up front: mentioning @sales makes `sales` a known identity. See [[Identity]] for more info.