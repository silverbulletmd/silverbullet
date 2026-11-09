---
description: "Icons, prefixes, CSS classes and navigation rules for pages."
tags: maturity/beta glossary
pageDecoration:
  icon: gift
  tree:
    priority: -1
  cssClasses:
  - christmas-decoration
references:
- plugs/index/page.ts
---
Page decorations add icons, prefixes, CSS classes and navigation rules to pages. Set them with the `pageDecoration` frontmatter field.

# Supported decorations
* `cssClasses`: (list of strings) Attaches one or more CSS classes the page’s `<body>` tag, wiki links, auto complete items and [[Page Picker]] entries for more advanced styling through a [[Space Style]] (see [[#Use case: pimp my page]] for an example).
* `icon`: The icon drawn with the page in the top bar, [[View|views]], auto complete, and page links. Use a [Feather](https://feathericons.com/) icon name (`star`), the same name namespaced (`feather:star`), or sanitized literal SVG markup.
* `tree.priority`: (number, default `0`) Floats the page above its lower-priority siblings in the space tree.
* `tree.hide`: (boolean) Keeps the page out of the space tree only, leaving it in the page picker and in completions.
* `prefix`: A textual string prefix to add to page names. It appears in the top bar, page picker, auto complete, and links to the page. Use `icon` instead when the prefix is only meant to be a visual symbol.
* `hide`: (boolean) Keeps the page out of navigation [[View|views]] (the page picker and space tree) and out of page completions. The picker’s “All” segment still lists it.

# Apply with [[Frontmatter]]
This is demonstrated in the [[Frontmatter]] at the top of this page, using the special `pageDecoration` attribute. The `gift` icon appears beside this page in the surfaces listed above.

## Use case: pimp my page
Use `cssClasses` to apply a custom style to a page and its links.

Note that in this page’s [[Frontmatter]] the `christmas-decoration` class is attached via `pageDecoration.cssClasses`. Now let’s hook into that with some [[Space Style]]:

```space-style

/* Style page links */
a.christmas-decoration {
  background-color: #b4e46e;
}

/* Style main editor components */
body.christmas-decoration #sb-top {
  background-color: #b4e46e;
}

/* Style auto complete items */
.cm-tooltip-autocomplete li.christmas-decoration {
  background-color: #b4e46e;
}

/* Style page picker item */
.sb-result-list .sb-option.christmas-decoration {
  background-color: #b4e46e;
}
```

This block doesn’t run here, because this isn’t a [[Tool Page]]. The live copy for this site is on [[^Library/Website/Doc Examples]].

To adapt the decoration, copy the frontmatter to your own page and the style to a page under `Library/` in your space.

# Apply to every page with a tag
To decorate every page with a tag, give the tag a `pageDecoration` in [[API/tag|tag.define]] in your [[^Library/Config]]:

```space-lua
tag.define {
  name = "person",
  pageDecoration = { icon = "user", cssClasses = { "person-page" } },
}
```

A page’s own `pageDecoration` (from its frontmatter, or a `transform`) wins over the tag’s. When several of a page’s tags set the same field, the first tag in its `tags` wins. `cssClasses` from all of them are combined. Changing a tag’s decoration re-indexes the pages with that tag, so there is no need to run `Space: Reindex`.
