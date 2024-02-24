Live Queries are a [[Blocks|block]] that generates a (quasi) live view on various data sources, usually [[Objects]], and renders their results inline via [[Live Preview]] either as a table or using [[Templates]].

The syntax used is:

    ```query
    page limit 3
    ```

Queries are written using SilverBullet’s [[Query Language]].

# Baking
A query block can be replaced with its current output by clicking the "Bake result" button in the top right corner. This will make it a regular part of page, which will not respond to changes in the data source anymore.

You can also use the {[Page: Bake live blocks]} command to do it in-place for every [[Blocks|block]] in this page which is rendered as Markdown (but not [[Live Template Widgets]]). You can undo the replacement with `Ctrl+Z`/`Cmd+Z` as usual, but if you want to keep your queries you shoud make a copy of the page first.
