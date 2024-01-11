Slash templates allow you to define custom [[Slash Commands]] that expand “snippet style” templates inline.

# Definition
You can define a slash template by creating a [[Templates|template page]] with a template tag and `trigger` attribute. If you’d like to (temporarily) disable the template, you can set the `enabled` attribute to `false`.

Example:

    ---
    tags: template
    trigger: meeting-notes
    ---
    ## Meeting notes for {{today}}!

    |^|

## Frontmatter
A template’s [[Frontmatter]] is interpreted by SilverBullet’s [[Templates|template]] engine and removed when instantiated. However, to still include frontmatter after instantiation, you can use the `frontmatter` attribute.

Example:

    ---
    tags: template
    trigger: meeting-notes
    frontmatter: |
       date: {{today}}
    ---
    ## Meeting notes for {{today}}!

    |^|

Which will expand into e.g.

    ---
    date: 2023-11-11
    ---
    ## Meeting notes for 2023-11-11

    .

When the page already contains frontmatter before invoking the slash command, it will be augmented with the additional frontmatter specified by the template.

# Use
You can _trigger_ the slash template by typing `/<trigger>` (e.g. `/meeting-notes`) in any page.
