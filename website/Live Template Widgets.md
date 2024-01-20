Live Template Widgets allow you to automatically render templated markdown widgets at the top or bottom of pages matching specific criteria.

> **warning** Warning
> This feature is still _experimental_, aspects of it may change, or it could be removed altogether.

# Defining
Live Template Widgets are regular [[Templates]] that set a `hooks.top` or `hooks.bottom` attribute (depending on where you would like them to appear), specifying:

* `where`: should contain an [[Live Queries$expression]] that evaluates to true for the _pages_ you would like to apply this template to, usually this checks for a specific tag, but it can be any expression. Think of this as a `where` clause that should match for the pages this template is applied to.
* `order` (optional): in case you have multiple templates that have matching `where` expression, the one with the priority set to the lowest number wins.

# Example
The following widget template applies to all pages tagged with `person` (see the `where`). It uses the [[Library/Core/Widget/Linked Tasks]] template to show all incomplete tasks that contain a link to the current page.

    ---
    tags: template
    hooks.top.where: 'tags = "person"'
    ---
    ## Incoming tasks
    ```template
    page: "[[!silverbullet.md/Library/Core/Widget/Linked Tasks]]"
    ```

More examples can be found [[Library/Core/Page/Template Index$widgets|here]].
