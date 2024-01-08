Templates are reusable pieces of markdown content, usually with placeholders that are replaced once instantiated.

There are two general uses for templates:

1. _Live_ uses, where page content is dynamically updated based on templates:
  * [[Live Queries]]
  * [[Live Templates]]
  * [[Live Template Widgets]]
2. _One-off_ uses, where a template is instantiated once and inserted into an existing or new page:
  * [[Slash Templates]]
  * [[Page Templates]]

# Creating templates
Templates are regular pages [[Tags|tagged]] with the `#template` tag. Note that, when tagged inline (by putting `#template` at the beginning of the page), the tag will be removed when the template is instantiated.

**Naming**: it’s common, although not required, to use a `template/` prefix when naming templates.

Tagging a page with a `#template` tag (either in the [[Frontmatter]] or using a [[Tags]] at the very beginning of the page content) does a few things:

1. It will make the page appear when completing template names, e.g. in `render` clauses in [[Live Queries]], or after the `page` key in [[Live Templates]].
2. It excludes the page from being indexed for [[Objects]], that is: any tasks, items, paragraphs etc. will not appear in your space’s object database. Which is usually what you want.
3. It registers your templates to be used as [[Slash Templates]] as well as [[Page Templates]].

## Frontmatter
[[Frontmatter]] has special meaning in templates. The following attributes are used:

* `tags`: should always be set to `template`
* `type` (optional): should be set to `page` for [[Page Templates]] and to `frontmatter` for [[Live Template Widgets]]
* `trigger` (optional): defines the slash command name for [[Slash Templates]]
* `displayName` (optional): defines an alternative name to use when e.g. showing the template picker for [[Page Templates]], or when template completing a `render` clause in a [[Live Templates]].
* `pageName` (optional, [[Page Templates]] only): specify a (template for a) page name.
* `frontmatter` (optional): defines [[Frontmatter]] to be added/used in the rendered template. This can either be specified as a string or as an object.

An example:

    ---
    tags: template
    type: page
    trigger: one-on-one
    displayName: "1:1 template"
    pageName: "1-1s/"
    frontmatter:
       dateCreated: "{{today}}"
    ---
    # {{today}}
    * |^|

# Template content
Templates consist of markdown, but can also include [Handlebars syntax](https://handlebarsjs.com/), such as `{{today}}`, and `{{#each .}}`.

The special `|^|` marker can be used to specify the desired cursor position after the template is included.

## Handlebar helpers
There are a number of built-in handlebars helpers you can use:

- `{{today}}`: Today’s date in the usual YYYY-MM-DD format
- `{{tomorrow}}`: Tomorrow’s date in the usual YYY-MM-DD format
- `{{yesterday}}`: Yesterday’s date in the usual YYY-MM-DD format
- `{{lastWeek}}`: Current date - 7 days
- `{{nextWeek}}`: Current date + 7 days
- `{{escapeRegexp "hello/there"}}` to escape a regexp, useful when injecting e.g. a page name into a query — think `name =~ /{{escapeRegexp @page.name}}/
`* `{{replaceRegexp string regexp replacement}}`: replace a regular expression in a string, example use: `{{replaceRegexp name "#[^#\d\s\[\]]+\w+" ""}}` to remove hashtags from a task name
- `{{json @page}}` translate any (object) value to JSON, mostly useful for debugging
- `{{substring "my string" 0 3}}` performs a substring operation on the first argument, which in this example would result in `my `
- `{{prefixLines "my string\nanother" "  "}}` prefixes each line (except the first) with the given prefix.
- `{{niceDate @page.lastModified}}` translates any timestamp into a “nice” format (e.g. `2023-06-20`).
- The `@page` variable contains all page meta data (`name`, `lastModified`, `contentType`, as well as any custom [[Frontmatter]] attributes). You can address it like so: `{{@page.name}}`
