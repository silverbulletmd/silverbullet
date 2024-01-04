Live Frontmatter Templates allow you to override the default rendering of [[Frontmatter]] at the top of your pages with a custom template.

If you have no idea what that means or what you would use this for; you probably don’t need this feature. Don’t worry about it.

# Defining
Live Frontmatter Templates follow the same pattern as other [[Templates]] with a few additional attributes:

* `tags`: should be set to `template` as for any other template
* `type`: should be set to `frontmatter`
* `selector`: should contain an [[Live Queries$expression]] that evaluates to true for the _pages_ you would like to apply this Live Frontmatter Template to, usually this checks for a specific tag, but it can be any expression. Think of this as a `where` clause that should match for the pages this template is applied to.
* `priority` (optional): in case you have multiple Live Frontmatter Templates that have matching selectors, the one with the priority set to the lowest number wins.

# Example
The following Frontmatter Template applies to all pages tagged with `person` (see the `selector`). It first lists all [[Frontmatter]] attributes, followed by a use of the [[!silverbullet.md/template/live/incoming]] template, showing all incomplete tasks that reference this particular page.

Indeed, you can use [[Live Queries]] and [[Live Templates]] here as well.

    ---
    tags: template
    type: frontmatter
    where: 'tags = "person"'
    ---
    {{#each .}}**{{@key}}**: {{.}}
    {{/each}}
    ## Incoming tasks
    ```template
    page: "[[!silverbullet.md/template/live/incoming]]"
    ```

## Plug frontmatter template
This site uses the [[internal-template/plug-frontmatter]] template for pages tagged with `plug`, such as [[Plugs/Editor]], [[Plugs/Github]] and [[Plugs/Mermaid]].


