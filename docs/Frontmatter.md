---
description: A YAML block at the top of a page that sets page-level attributes.
status: Complete
tags: glossary
references:
- client/codemirror/frontmatter.ts
- client/codemirror/frontmatter_folding.ts
- plugs/index/frontmatter.ts
---
Frontmatter is a common format to attach additional metadata (data about data) to markdown documents. Many tools support it as a markdown [[Markdown/Extensions|extension]].

In SilverBullet, there are multiple ways to attach [[Metadata]] to a page; frontmatter is the most popular one.

You create frontmatter by starting your markdown document with `---` followed by [[YAML]] encoded attributes and then ending with `---` again. Followed by the regular body of your document. This very page contains some frontmatter, click on it to see the underlying code.

Here is another example:

    ---
    status: Draft
    tags:
    - tag1
    - tag2
    seeAlso: "[[YAML]]"
    ---
    ## This is a section
    This is content

For convenience, you may use the `attribute.subAttribute` notation, which internally will expand:

```yaml
attribute.subAttribute: 10
```

to

```yaml
attribute:
   subAttribute: 10
```

# Folding
Frontmatter can be folded in the editor. By default, frontmatter blocks with more than 5 lines fold automatically when you open a page, unless your cursor or selection is inside the frontmatter. When folded, frontmatter with a `tags` key previews those tags as tag chips.

You can configure this in your [[CONFIG]] page with `frontmatterFolding`:

Never auto-fold frontmatter:

```lua
config.set("frontmatterFolding", {
  foldByDefault = "never",
})
```

Always auto-fold frontmatter:

```lua
config.set("frontmatterFolding", {
  foldByDefault = "always",
})
```

Only auto-fold frontmatter above a custom line threshold:

```lua
config.set("frontmatterFolding", {
  foldByDefault = "long",
  foldByDefaultLines = 10,
})
```

# Special attributes
While SilverBullet allows arbitrary metadata to be added to pages, there are a few attributes with special meaning:

* `name` (==DISALLOWED==): is an attribute used for page names, _you should not set it_.
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

For specific use cases, like [[^Library/Std/Infrastructure/Page Templates]] or [[^Library/Std/Infrastructure/Slash Templates]], frontmatter may have specific meaning.
