Slash templates allow you to define custom [[Slash Commands]] that expand “snippet style” templates inline. They’re like [[🔌 Template$snippets]], but appear immediately as slash commands.

## Definition
You can define a slash template by creating a [[Templates|template page]] with a template tag and `trigger` attribute. 

Example:

    ---
    tags: template
    trigger: meeting-notes
    ---
    ## Meeting notes for {{today}}!

    |^|

## Use
You can _trigger_ the slash template by typing `/meeting-notes` in any page. That’s it.

## Frontmatter
A template’s [[Frontmatter]] is interpreted by SilverBullet’s template engine and removed when instantiated. However, to still include frontmatter after instantiation, you can use the `frontmatter` attribute.

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

