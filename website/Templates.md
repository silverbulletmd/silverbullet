Templates are reusable pieces of (markdown) content, often containing placeholders that are replaced once instantiated written in SilverBullet’s [[Template Language]].

Templates are kept in your space. They’re effectively regular [[Pages]], and are [[Tags|tagged]] with the `template` tag.

Templates do not appear in the [[Page Picker]], but instead appear in the [[Template Picker]]. They are not offered as auto complete suggestions when creating regular page links, only when doing so in the context of e.g. a [[Live Queries]] and [[Live Templates]].

In SilverBullet templates serve a few purposes:

1. _Live_ uses, where page content is dynamically updated based on templates:
  * [[Live Queries]]
  * [[Live Templates]]
  * [[Live Template Widgets]]
2. _One-off_ uses, where a template is instantiated once and inserted into an existing or new page:
  * [[Snippets]]
  * [[Page Templates]]

# Definition
Templates are regular pages [[Tags|tagged]] with the `#template` tag. Note that when tagged inline (by putting `#template` at the beginning of the page), the tag will be removed when the template is instantiated.

Tagging a page with a `#template` tag (either in the [[Frontmatter]] or using a [[Tags]] at the very beginning of the page content) does a few things:

1. It will make the page appear when completing template names, e.g. in `render` clauses in [[Live Queries]], or after the `page` key in  [[Live Templates]].
2. The template page no longer appears in the [[Page Picker]], instead you now navigate to it using the [[Template Picker]].
3. It can register your templates to be used as [[Snippets]], [[Page Templates]] or [[Live Template Widgets]].

## Frontmatter
[[Frontmatter]] has special meaning in templates. The following attributes are used:

* `tags`: should always be set to `template`
* `displayName` (optional): defines an alternative name to use when e.g. showing the template picker for [[Page Templates]], or when template completing a `render` clause in [[Live Templates]].
* `description` (optional): may appear in various UIs to give more information about the template.
* `frontmatter` (optional): defines [[Frontmatter]] to be added/used in the _rendered_ template. This can either be specified as a string or as an object.
* `hooks` (optional): hook the template into various parts of the system, look at [[Page Templates]], [[Snippets]] and [[Live Template Widgets]] for details.

An example:

    ---
    tags: template
    hooks.newPage.suggestedName: "Meetings/{{today}}"
    frontmatter:
       dateCreated: "{{today}}"
    ---
    # {{today}}
    * |^|

# Content
Templates consist of plain markdown text, but can also include [Handlebars syntax](https://handlebarsjs.com/), such as `{{today}}`, and `{{#each .}}`.

A special `|^|` marker can be used to specify the desired cursor position after the template is included.

## Handlebar helpers
There are a number of built-in handlebars helpers you can use:

- `{{today}}`: Today’s date in the usual YYYY-MM-DD format
- `{{tomorrow}}`: Tomorrow’s date in the usual YYY-MM-DD format
- `{{yesterday}}`: Yesterday’s date in the usual YYY-MM-DD format
- `{{lastWeek}}`: Current date - 7 days
- `{{nextWeek}}`: Current date + 7 days
- `{{escapeRegexp "hello/there"}}` to escape a regexp, useful when injecting e.g. a page name into a query — think `name =~ /{{escapeRegexp @page.name}}/
- `{{json @page}}` translate any (object) value to JSON, mostly useful for debugging
- `{{substring "my string" 0 3}}` performs a substring operation on the first argument, which in this example would result in `my `
- `{{prefixLines "my string\nanother" "  "}}` prefixes each line (except the first) with the given prefix.
- `{{niceDate @page.lastModified}}` translates any timestamp into a “nice” format (e.g. `2023-06-20`).
- The `@page` variable contains all page metadata (`name`, `lastModified`, `contentType`, as well as any custom [[Frontmatter]] attributes). You can address it like so: `{{@page.name}}`
