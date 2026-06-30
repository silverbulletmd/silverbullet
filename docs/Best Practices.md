#guide

Let’s be clear upfront: your space is your own, you can structure it however you like. That said, over the years a few “best practices” of how to structure your space have emerged. 

If you don’t have strong preferences coming in, consider following them.

# Flat name space
While SilverBullet will dynamically create [[Folder|Folders]] when you use slashes (`/`) in your page names, the typical SilverBullet user tends to use this feature lightly.

Organization is achieved through incrementally adding [[Frontmatter]] and [[Markdown/Hashtags]], rather than investing in a very structured folder structure upfront. This is also why, by default, SilverBullet does not ship with the classic file tree — it would be very boring to look at.

The advantage of this approach is multi-fold:

1. Reduces “decision fatigue”: you create a new page, where should you put it? Answer: top level.
2. Whereas a page can only ever live in a single folder, it can be tagged with an unlimited number of hashtags. This gives more flexibility.

As a result, this means that most content pages tend to live at the “top level” (see this space as an example).

A few exceptions:
* `Inbox/` for quick notes
* `Journal/` for journal entries
* `Library/` for [[Library|libraries and customizations]]

These make sense to split out, and keep contained in their own folders, away from other areas of your space.

# Frontmatter and tags
When adding a [[Frontmatter]] section to a page, it becomes cleaner to move any [[Markdown/Hashtags]] you previously put in your page to the `tags` attribute:

```yaml
---
role: Data analyst
tags: sometag anothertag
---
```

# Page conventions
* **Title-Case page names**: name a page as you’d write its title in prose: `Customer Persona`, not `customer-persona`. See [[Names]] for additional rules and hard constraints.
* **No top-of-page H1**: the page name is already the title, don’t restate it as an `# H1`.
* **First line is a one-sentence summary**: the opening body line defines or summarises the page, this is what link previews and catalogs quote.
* **Absolute wiki links**: links are paths from the space root: `[[Folder/Page]]`. This way, links stay valid no matter where the linking page lives or moves. See [[Link]].

# Querying your space
SilverBullet's [[Object Index]] is the engine behind every live query:

* Prefer `index.contentPages()` over `tags.page` for page lists and lint sweeps — it filters out [[Meta Page|Meta Pages]] (pages tagged `meta` or `meta/*`) so Library and configuration pages do not pollute your results. See [[Object Index]].
* The index is **asynchronous** — after editing a page, expect a few seconds before queries reflect the change. Re-run before drawing conclusions. See [[Object Index]].
* For cross-cutting collections (all open questions, all ADRs), use the **aggregator page + `tagPage`** pattern instead of hand-maintained lists. See [[Aggregator Pages]].
* Find broken or forward-references via the `aspiring-page` tag. See [[Aspiring Pages]].

# Authoring Space Lua
When developing on a `space-lua` based feature, follow the edit, reload, check (browser) logs, verify loop: edit a script, run `System: Reload` (Ctrl-Alt-r) to re-execute all definitions, then **check the console logs**. A successful reload does not mean the script is healthy, Lua errors surface in logs, not always as a visible reload failure. For a programmatic “reboot to ready” call that also drains the index queue, see [[API/system#system.reboot()]].