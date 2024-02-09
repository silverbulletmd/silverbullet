Templates are pieces of (markdown) text that contain placeholders (named _directives_) that are replaced once instantiated. Templates are written in SilverBullet’s [[Template Language]].

Like everything else, templates are kept in your space. They’re effectively regular [[Pages]], and are [[Tags|tagged]] with the `template` tag.

However, templates **do not appear** in the [[Page Picker]]. Instead, they appear in the [[Template Picker]]. They are not offered as auto complete suggestions when creating regular page links, only when doing so in the context of e.g. a [[Live Queries]] and [[Live Templates]].

In SilverBullet templates serve a few purposes:

1. _Live_ uses, where page content is dynamically updated based on templates:
  * [[Live Templates]]
  * [[Live Queries]]
  * [[Live Template Widgets]]
2. _One-off_ uses, where a template is instantiated once and inserted into an existing or new page:
  * [[Snippets]]
  * [[Page Templates]]

# Video walkthrough
If you prefer to watch rather than read, here’s an overview of SilverBullet’s template system and what it can do.

```embed
url: https://www.youtube.com/watch?v=ZiM1RM0DCgo
```


# Definition
Templates are regular pages [[Tags|tagged]] with the `#template` tag. Note that when tagged inline (by putting `#template` at the beginning of the page), that tag will be removed when the template is instantiated.

Tagging a page with a `template` does a few things:

1. It will make the page appear when completing template names, e.g. in `render` clauses in [[Live Queries]], or after the `page` key in  [[Live Templates]].
2. The template page no longer appears in the [[Page Picker]], instead you now navigate to it using the [[Template Picker]].
3. It can register your templates to be used as [[Snippets]], [[Page Templates]] or [[Live Template Widgets]].

Templates are written in [[Template Language]]

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

