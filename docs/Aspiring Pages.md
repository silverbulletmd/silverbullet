---
description: An aspiring page is a page that does not yet exist, but is already linked to.
tags: glossary
references:
- plugs/index/relation.ts
---

An aspiring page is a [[Page|page]] that does not yet exist, but is already linked to.

Aspiring pages appear in the [[Page Picker]] (with a `Create page` hint) as well as in auto complete when creating [[Link]].

# Finding dangling links
Every `[[link]]` to a non-existent page produces an `aspiring-page` object in the [[Object Index]], so you can query them to audit broken or forward-references:

${query[[
  from t = index.aspiringPages()
  where not string.startsWith(t.page, "Library/")
  select { target = t.name, linkedFrom = t.page }
]]}

In this query, `t.name` is the link **target** (the page that does not yet exist); `t.page` is **where the link lives** (the source page). Filter on `t.page` to scope results to your own content.

Triage guidance:
- **Real typo**: fix the link on the source page.
- **Intentional placeholder**: you mean to write the page eventually, then leave it. Aspiring pages double as a "to-write" backlog and appear in the page picker as a reminder.
- **Library/meta target**: not yours to fix, those links are maintained by the library.