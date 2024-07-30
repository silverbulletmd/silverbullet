---
pageDecoration.prefix: "🎄 "
pageDecoration.disableTOC: true
---
Page decorations allow you to “decorate” pages in various ways.

> **warning** Warning
> This feature is still experimental and may change in the (near) future.

# Supported decorations
* `prefix`: A (visual) string prefix (often an emoji) to add to all page names. This prefix will appear in the top bar as well as in (live preview) links to this page. For example, the name of this page is actually “Page Decorations”, but when you link to it, you’ll see it’s prefixed with a 🎄: [[Page Decorations]]
* `hide` When this is set to `true`, the page will not be shown in [[Page Picker]], [[Meta Picker]], or suggested for completion of [[Links]]. It will otherwise behave as normal - will be [[Plugs/Index|indexed]] and found in [[Live Queries]]. The page can be opened through [[All Pages Picker]], or linked normally when the full name is typed out without completion.
* `disableTOC` (not technically built-in, but a feature of the [[^Library/Core/Widget/Table of Contents]] widget): disable the [[Table of Contents]] for this particular page.

There are two ways to apply decorations to pages:

# With [[Frontmatter]] directly
This is demonstrated in the [[Frontmatter]] at the top of this page, by using the special `pageDecoration` attribute. This is how we get the fancy tree in front of the page name. Sweet.

# With [[Object Decorators]]
The more useful way is to apply decorations to pages _dynamically_, for this we will leverage the more powerful [[Object Decorators]] feature. Read the [[Object Decorators]] page for a more in-depth explanation of how this feature works if you’re interested (as you should be, because it’s pretty cool on its own).

For the purposes of [[Page Decorations]], let us limit simply to some useful examples.

## Example: page prefix
Let’s say we want to put a 🧑 prefix on every page tagged with `#person`. We can achieve this as follows in our [[^SETTINGS]]:
```yaml
objectDecorators:
- where: "tags = 'person'"
  pageDecoration.prefix: '"🧑 "'
```

Note the (perhaps) strange double quoting there, both the `where` and the value for the attributes are [[Expression Language|expressions]] encoded inside of YAML. It’s a bit weird, but it works.

## Example: disabling [[Table of Contents]]
Let’s say that adding this `pageDecoration.disableTOC` to the front matter is too much effort to disable the TOC on some pages. Therefore, you would like to simplify this by simply adding a `#notoc` tag to your pages.

You can do this as follows:

```yaml
objectDecorators:
- where: 'tags = "notoc"'
  attributes:
     pageDecoration.disableTOC: "true"
```

## Example: Plug prefix
Here on silverbullet.md, we have a decoration like this for pages tagged with `#plug`: [[Plugs/Emoji]] and [[Plugs/Git]] for instance.

