---
description: A wiki-link or Markdown link connecting pages in your space.
tags: glossary
references:
- client/codemirror/wiki_link.ts
- client/codemirror/wiki_link_processor.ts
- plug-api/lib/ref.ts
- plug-api/lib/resolve_path.ts
---

In SilverBullet, you can create links to pages or documents inside your space as well as to external resources, using different link formats.

# Internal links
* _Wiki links_ use the `[[page]]` syntax. An alias can be added like this `[[page|This link points to page]]`. How a wiki link finds its target is described under [[#Link resolution]]
- _Relative internal links_, using the `[title](<relative specifier><link>)` format. The _relative specifier_ can be used to move up the file tree (or down, if you picture a file tree like this 🌳) relative to the page the link is on, similar to POSIX file systems `/../`. The _link_ has to conform to the [[#Link syntax (String refs)|link syntax]]

# External links
- _Markdown links_, using the `[title](URL)` syntax, for instance: [SilverBullet community](https://community.silverbullet.md). If the URL contains a space or closing parenthesis, you can enclose the URL in angled brackets.
* _"[AutoLinks](https://spec.commonmark.org/current/#autolinks)"_, like <https://community.silverbullet.md>
* _“Naked” URL links_ (AKA _"Bare URLs"_), like https://community.silverbullet.md

# Link syntax (String refs)
The link or “string refs” has to follow some specific formatting:
* A string ref starting with `^` links to a meta page, see [[#Caret page links|caret page links]]
* The "core" (After a possible `^` and before a `@` or `#`) of a string ref is a [[Names|name]] or [[Paths|path]].
  * The core of a  string ref can also be empty, an empty path points to the current page for links, and to the index page for `editor.navigate`
* A string ref can end three ways:
  * `#` followed by a string (which can also contain `#`). This will point to the header equal to that string. (Notably you can't link to every possible header, because e.g. `]]` will restrict you inside a wikilink for example.), e.g. [[SilverBullet#Introduction]]
  - `@` followed by an upper or lowercase `L` followed by a number, optionally followed by an upper or lowercase `C` followed by a number (e.g. `@l12c13`). This will point to the corresponding line and column inside a page (both 1-based), e.g. [[CHANGELOG@L12C42]]
  - `@` followed by a number _n_. This will point to the _nth_ character in the page (0-based), e.g. [[CHANGELOG@123]]

# Link resolution
A wiki link target is resolved against the space in two steps:

1. **Exact path match**: if the ref matches a page or document path from the space root, that file is the target. An exact match always wins.
2. **Name lookup**: if no file exists at the literal path, SilverBullet looks for files matching the ref _anywhere_ in the space, comparing case-insensitively. A bare name (no `/`) matches any file carrying that name; a ref containing `/` matches any file whose path _ends_ in it (on folder boundaries, so `[[api/Auth]]` matches `docs/api/Auth` but not `webapi/Auth`). Candidates spelled with the exact same case are preferred; if exactly one remains, that is the target.

So `[[Note]]` finds `some/folder/Note` when that is the only page named `Note`, `[[note]]` finds `Note` when nothing is spelled `note` exactly, and `[[api/Auth]]` finds `docs/api/Auth` when no other path ends in `api/Auth`.

Suffix matching is what makes links independent of where the space root sits: open a space at the _parent_ of the folder it was authored in, and both its bare links and its path-qualified ones keep resolving, because neither encodes the root.

Because an exact match always wins, a page at the space root beats a page in your own folder: with both `Config` and `docs/api/Config` in the space, a `[[Config]]` written on `docs/api/Auth` resolves to the root-level `Config`. Such a link is *not* flagged as ambiguous — its text is already the full path of the page it finds, so there is nothing you could write instead.

A bare name that matches nothing at all is a dangling link and produces an [[Aspiring Pages|aspiring page]] at the space root.

Name lookup also applies to [[Document|documents]] and [[Transclusions|transclusions]], so `![[diagram.png]]` finds `assets/diagram.png`. It does _not_ apply to relative [[#Internal links|Markdown links]], which keep their folder-relative meaning.

## Ambiguous links
When the name lookup matches several files and **none of them is an exact match**, the link is **ambiguous**. In this case, SilverBullet highlights it in the editor and when clicking it, you get to choose which matching page to navigate to.

A link that matches a file exactly is never ambiguous, however many other files share its name: `[[Tag]]` means `Tag`, even in a space that also has `Object/tag` and `API/tag`. Ambiguity is only reported when picking a different candidate would actually change the link text.

Candidates are ranked relative to the page the link is written on:
1. **Proximity**: the deepest folder prefix shared with the linking page wins — your own folder first, then the nearest common ancestor.
2. **Shallowest path**, which lets a root-level page win once proximity ties.
3. **Alphabetical order**, as the final tie-break.

Every ambiguous link to a page is indexed as an [[Object/ambiguous-link|ambiguous-link]] object, so you can find them all (this is used in [[^Library/Std/Pages/Maintenance]]):

${query[[
  from a = index.objects("ambiguous-link")
  select { link = a.name, page = a.page, resolvesTo = a.resolvesTo }
]]}

# Link write format
The `linkWriteFormat` option in your [[CONFIG]] controls how SilverBullet writes wiki links _it_ generates (through auto complete, and the backlink rewriting that happens when you rename a page). It has no effect on [[#Link resolution|resolution]]: all formats resolve identically, so a space mixing them works fine.

Options:

* `shortest` (the default): write the bare page name when that name is unique in the space, and the full path when it is not.
* `shortest-suffix`: like `shortest`, but when the name collides, write the shortest path suffix that still uniquely identifies the page (`api/Auth` rather than `docs/api/Auth`) — so even disambiguated links stay independent of where the space root sits.
* `full-path`: always write the full path.

```lua
config.set("linkWriteFormat", "full-path")
```

Because `shortest` is the default, renaming a page rewrites its backlinks into bare form wherever the name is unique — so a rename in a space with folders produces a link-format change in the same edit. In a space without folders the two formats produce the same text.

# Caret page links
[[Meta Page]] are excluded from link auto complete in many contexts. However, you may still want to reference a meta page outside of a “meta context.” To make it easier to reference, you can use the caret syntax: `[[^Library/Std]]`. Semantically this has the same meaning as `[[Library/Std]]` — it resolves exactly the same way. The only difference is that auto complete will _only_ complete meta pages.

Caret links are always written as **full paths**, whatever `linkWriteFormat` says: auto complete inserts the whole path, and renames rewrite them to the whole path. A meta page's folder is what identifies it — shortening `[[^Library/Std/APIs/Tag]]` to `[[^Tag]]` would point at the ordinary `Tag` page instead.
