Live Template Widgets allow you to automatically render templated markdown widgets to the top or bottom of pages matching specific criteria.

> **warning** Warning
> This feature is still _experimental_, aspects of it may change, or it could be removed altogether.

If you have no idea what that means or what you would use this for; you probably don’t need this feature. Don’t worry about it.

# Defining
Live Template Widgets follow the same pattern as other [[Templates]] with a few additional attributes:

* `tags`: should be set to `template` as for any other template
* `type`: should be set to `widget:top` or `widget:bottom` depending on where you would like it to appear
* `where`: should contain an [[Live Queries$expression]] that evaluates to true for the _pages_ you would like to apply this template to, usually this checks for a specific tag, but it can be any expression. Think of this as a `where` clause that should match for the pages this template is applied to.
* `priority` (optional): in case you have multiple templates that have matching `where` expression, the one with the priority set to the lowest number wins.
* `enabled` (defaults to `true`): in case you want to (temporarily) disable this template, set this to `false`.

# Example
The following widget template applies to all pages tagged with `person` (see the `where`). It uses the [[!silverbullet.md/template/live/incoming]] template, to show all incomplete tasks that reference this particular page.

Indeed, you can use [[Live Queries]] and [[Live Templates]] here as well.

    ---
    tags: template
    type: widget:top
    where: 'tags = "person"'
    ---
    ## Incoming tasks
    ```template
    page: "[[!silverbullet.md/template/live/incoming]]"
    ```

## Table of contents
The [[Table of Contents]] as it appears on this site is implemented using a template: [[template/widget/toc]].

## Linked Mentions
The [[Linked Mentions]] as they appear on this site are also implemented using a template: [[template/widget/linked-mentions]].

## Plug widget template
This site uses the [[internal-template/plug-widget]] template for pages tagged with `plug`, such as [[Plugs/Editor]], [[Plugs/Github]] and [[Plugs/Mermaid]].


