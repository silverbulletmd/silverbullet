---
pageDecoration:
  prefix: "🎄 "
  disableTOC: true
  cssClasses:
  - christmas-decoration
---
Page decorations allow you to “decorate” pages in various fun ways.

> **warning** Warning
> This feature is still experimental and may change in the (near) future.
 
# Supported decorations
* `prefix`: A (visual) string prefix (often an emoji) to add to all page names. This prefix will appear in the top bar as well as in (live preview) links to this page. For example, the name of this page is actually “Page Decorations”, but when you link to it, you’ll see it’s prefixed with a 🎄: [[Page Decorations]]
* `cssClasses`: (list of strings) Attaches one or more CSS classes the page's `<body>` tag, wiki links, auto complete items and [[Page Picker]] entries for more advanced styling through a [[Space Style]] (see [[#Use case: pimp my page]] for an example).
* `hide` When this is set to `true`, the page will not be shown in [[Page Picker]], [[Meta Picker]], or suggested for completion of [[Links]]. It will otherwise behave as normal - will be [[Plugs/Index|indexed]] and found in [[Live Queries]]. The page can be opened through [[All Pages Picker]], or linked normally when the full name is typed out without completion.
* `disableTOC` (not technically built-in, but a feature of the [[^Library/Core/Widget/Table of Contents]] widget): disable the [[Table of Contents]] for this particular page.
* `renderWidgets`: when set to `false` disables the [[Live Preview]] rendering of elements like [[Transclusions]], [[Live Queries]], [[Live Templates]] for this page.

There are two ways to apply decorations:

# With [[Frontmatter]] directly
This is demonstrated in the [[Frontmatter]] at the top of this page, by using the special `pageDecoration` attribute. This is how we get the fancy tree (🎄) in front of the page name. Sweet.

# With [[Object Decorators]]
The more useful/scalable way is to apply decorations to pages _dynamically_, for this we will leverage the more powerful [[Object Decorators]] feature. Read the [[Object Decorators]] page for a more in-depth explanation of how this feature works if you’re interested (as you should be, because it’s pretty cool on its own).

For the purposes of [[Page Decorations]], let us limit simply to some useful examples.

## Use case: plug page prefix
Here on silverbullet.md, we have a `prefix` decoration for pages tagged with `#plug`: [[Plugs/Emoji]] and [[Plugs/Git]] for instance.

This is configured as follows:
```space-config
objectDecorators:
- where: 'tag = "page" and tags = "plug"'
  attributes:
     pageDecoration.prefix: "'🔌 '"
```

## Use case: disabling [[Table of Contents]] with a tag
Let’s say that adding `pageDecoration.disableTOC` to the front matter is too much effort to disable the TOC on some pages. Therefore, you would like to simplify this by simply adding a `#notoc` tag to your pages.

You can do this as follows:

```space-config
objectDecorators:
- where: 'tags = "notoc"'
  attributes:
     pageDecoration.disableTOC: "true"
```

## Use case: pimp my page
Let’s say you feel you want to pimp up a specific page with some Christmas-level decoration, and prefixing it with a tree just doesn’t do it for you. The `cssClasses` decoration is saying: hold my beer. 

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

And _boom_! Ain’t that pretty?
