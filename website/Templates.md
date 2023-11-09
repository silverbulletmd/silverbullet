For various use cases, SilverBullet uses [Handlebars templates](https://handlebarsjs.com/).

Generally templates are stored in your space as regular pages, which allows for reuse. Some examples include [[template/task]] and [[template/page]].
As a convention, we often name templates with a `template/` prefix, although this is purely a convention.

[[Live Templates]] allow templates to be defined inline, for instance:
```template
template: |
   Hello, {{name}}! Today is _{{today}}_
value:
   name: Pete
```
### Template helpers
There are a number of built-in handlebars helpers you can use

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
