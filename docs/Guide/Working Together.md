#guide

This guide walks through what a [[Collaboration]] model can look like in practice using SilverBullet, it covers creating accounts, deciding what each of them may do, working in the same pages without stepping on each other, addressing one another in the content itself, and seeing who changed what.

# Setting up a shared space
The [[Dashboard]] is used to create spaces, accounts and decide what each account can do on which space.

Access to a space then resolves to one of three levels:
* `none`: no access at all
* `read`: read-only access
* `write`: read and write access

# Working on the same content
SilverBullet handles concurrent edits fairly well: a change made elsewhere shows up within a couple of seconds, applied as a small cursor-preserving edit. There is currently no “presence” information shared (cursor locations, selections).

While this is not Google Docs, edits even to the level of words tend to merge cleanly, and when SilverBullet is confused about intent, you can use a conflict marker widget to resolve it.

# Addressing users
Anyone with access to the space is represented as an [[Identity]], addressed by their account username. Writing `@dana` in a page is an [[At-Mention]], and it means: *this is for you*.

Eac mention sets a `recipients` attribute onto the object that hosts it, and is collected in the **Mention Inbox**, a sidebar view of open mentions grouped by page, opened with ${widgets.commandButton("Navigate: Mentions")} or by clicking any mention. A page that is wholly “for” someone can say so in [[Frontmatter]] instead:

```yaml
---
recipients: dana
---
```

Typically there’s two contexts in which you may want to use at mentions:

* [[Task]] assignments, e.g.:
  * [ ] Please fix this bug @zef
* [[Markdown/Comment|Comments]] which allow for a type of “out of band” conversation. Here is an example:
  <!--
  > “out of band”

  @zef really, you’re going to use terms like that? -- @anonymous
  -->

# Seeing who did what
Attribution shows up in two places, both drawing on the full name and email from an account’s profile.

In the editor, text arriving from elsewhere is briefly highlighted as it lands.

Over longer spans, [[Revisions]] carries the same information into page and space history, so a change can be traced back to the account that made it after the fact.
