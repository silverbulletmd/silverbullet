---
tags: guide
---
A [[Concepts/Space]] does not have to be yours alone. This guide walks through running one that several people share: giving them accounts, deciding what each of them may do, working in the same pages without stepping on each other, addressing one another in the content itself, and seeing who changed what.

# Setting up a shared space
The [[Features/Space Manager]] is used to create spaces, accounts and decide what each account can do on which space.

Access to a space then resolves to one of three levels:
* `none`: no access at all
* `read`: read-only access
* `write`: read and write access

# Working on the same content
While not its strongest suit (yet), SilverBullet handles concurrent edits fairly well: a change made elsewhere shows up within a couple of seconds, applied as a small cursor-preserving edit rather than a reload, and lands in your undo history like any edit of your own.

Edits to *different* words merge cleanly. Edits to the *same* words collide, and when SilverBullet is confused about intent, you can use a conflict marker widget to resolve it.

# Addressing users
Anyone with access to the space is represented as an [[Concepts/Identity]], addressed by their account username. Writing `@dana` in a page is an [[Concepts/At-Mention]], and it means: *this is for you*.

Mentions don’t just look cool, they are are indexed too. Each stamps a `recipients` attribute onto the object that hosts it (a task or list item it sits in, or the page itself for a plain paragraph), and collects in the **Mention Inbox**, a sidebar view of open mentions grouped by page, opened with `Navigate: Mentions` or by clicking any mention. A page that is wholly “for” someone can say so in [[Concepts/Frontmatter]] instead:

```yaml
---
recipients: dana
---
```

You _could_ this mechanism as a type of internal e-mail system this way.

Two related conventions round this out:

* [[Markdown/Comment|Comments]] wrap a note to a colleague in an HTML comment, which SilverBullet renders and indexes as ordinary markdown while other markdown tools hide it. `Comment: Add` is a convenient way to add a comment, its “Resolve” button deletes it once it has been dealt with.
* Signatures are used to credit a user. `Mention: Sign` (or `/sign`) appends `-- @you` to the current block, which is how you answer a mention without queuing a fresh request back to yourself. See [[Concepts/Authorship]]. 

# Seeing who did what
Attribution shows up in two places, both drawing on the full name and email from an account’s profile.

In the editor, text arriving from elsewhere is briefly highlighted as it lands.

Over longer spans, [[Features/Revisions]] carries the same information into page and space history, so a change can be traced back to the account that made it after the fact.
