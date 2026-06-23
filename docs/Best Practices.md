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