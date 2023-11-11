Templates are _reusable_ pieces of markdown content, usually with placeholders that are replaced once instantiated.

Templates are used in a few different contexts:

1. To render [[Live Queries]]
2. To render [[Live Templates]]
3. To be included using [[Slash Templates]]
4. Some legacy use cases described in [[🔌 Template]]

## Creating templates
Templates are defined as any other page. It’s convenient, although not required, to use a `template/` prefix when naming templates. It is also _recommended_ to tag templates with a `#template` tag. Note that this tag will be removed when the template is instantiated.

Tagging a page with a `#template` tag (either in the [[Frontmatter]] or using a [[Tags]] at the very beginning of the page content) does two things:

1. It excludes the page from being indexed for [[Objects]], that is: any tasks, items, paragraphs etc. will not appear in your space’s object database. Which is usually what you want.
2. It allows you to register your templates to be used as [[Slash Templates]].

Templates consist of markdown, but can also include [Handlebars syntax](https://handlebarsjs.com/), such as `{{today}}`, and `{{#each .}}`.

In addition the special `|^|` marker can be used to specify the desired cursor position after the template is included (relevant mostly to [[Slash Templates]]).

### Template helpers
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
