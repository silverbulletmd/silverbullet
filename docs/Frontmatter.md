---
description: "Page attributes edited through a form and stored as YAML at the top of the page."
tags: glossary
references:
- client/codemirror/syntax/frontmatter.ts
- client/codemirror/syntax/frontmatter_preview.ts
- plugs/index/frontmatter.ts
---
Frontmatter stores page attributes such as tags, status and dates. Edit them using the form at the top of a page, or edit their YAML source directly.

# Start with the visual editor
On a page without frontmatter, hover over the first line and click the **add tag** icon to its left. Type a tag and press Enter. The form opens at the top of the page. **+ add attribute** lets you add more attributes and choose their types.

[[Guide/Add Structure and Query]] walks through this with screenshots, starting from an ordinary Markdown page. [[Live Object Edit]] covers the form’s editing controls. In read-only documentation, you can inspect existing attributes but cannot add or change them.

# The source format
Choose **Edit source** from the form’s ⋯ menu to see what it stores. Frontmatter is a [[YAML]] block at the beginning of the file, between two lines containing `---`. The page body follows the closing line:

```markdown
---
status: planned
tags: outing
date: "2026-06-14"
---
Notes for the photo walk.
```

Move the cursor outside the block to return to its form. Many other Markdown tools recognize this [[Markdown/Extensions|extension]], so these attributes stay with your file.

For convenience, you may use the `attribute.subAttribute` notation, which internally will expand:

```yaml
attribute.subAttribute: 10
```

to

```yaml
attribute:
   subAttribute: 10
```

# Special attributes
While SilverBullet allows arbitrary metadata to be added to pages, there are a few attributes with special meaning:

* `name`: the indexed page name comes from its filename. Do not use frontmatter to rename an ordinary page. Some specialized formats, such as [[Library/Development|library manifests]], use a `name` key as installation metadata. Follow that format’s instructions.
* `displayName` (`string`): very similar in effect as `aliases` but will use this name for the page in certain contexts.
* `aliases` (`array of strings`): allow you to specify a list of alternative names for this page, which can be used to navigate or link to this page
* `tags` (`array of strings` or `string`): an alternative (and perhaps preferred) way to assign [[Tag]] to a page. There are various ways to define these:
  ```yaml
  tags: tag1, tag2 # with commas
  tags: tag1 tag2 # with spaces
  tags: "#tag1 #tag2" # with pound signs and quotes (with auto completion)
  tags: # as a list
  - tag1
  - tag2
  tags: # as a list with pound signs and quotes
  - "#tag1"
  - "#tag2"
  ```

> **note** Recommended style
> Prefer **space-separated bare words on a single line** — `tags: market competitors` — over the YAML-list form. It is the most common SilverBullet convention and the least visually noisy. All the forms above remain valid for compatibility. If you care about Obsidian compatibility, use YAML lists.

For specific use cases, like [[^Library/Std/Infrastructure/Page Templates]] or [[^Library/Std/Infrastructure/Slash Templates]], frontmatter may have specific meaning.
