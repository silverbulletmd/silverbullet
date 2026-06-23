A baked section is a piece of dynamic content whose rendered output has been written *into* the page as plain [[Markdown]], wrapped in HTML comments so SilverBullet can keep it up to date while other tools just see the result.

# Why
SilverBullet’s most powerful features (`${...}` [[Space Lua]] expressions, [[Space Lua/Integrated Query|queries]], and [[API/widget|widgets]]) are computed live in the editor. That is wonderful inside SilverBullet, but the underlying [[Markdown]] only contains the *source* of the computation. Open such a page on GitHub, in another markdown editor, and instead of a neat table you get to see the raw expressions. This limits your options in further processing markdown (e.g. using some publish tool) or to keep it tool independent.

# How baking works
A baked section keeps the expression *and* its rendered output side by side, using HTML comments as delimiters:

    <!--#lua query[[ from f = tags.feature where f.tag == "page" select f.name ]] -->
    | name |
    | ---- |
    | Baked Sections |
    | Publishing |
    <!--/lua-->

The two `<!-- ... -->` markers are ordinary HTML comments, so **every markdown renderer ignores them** — GitHub, Obsidian, a plain viewer. What they render is the body in between: a real markdown table. Inside SilverBullet the markers are shown as subtle, grayed-out comments, and the expression in the opening marker is the source of truth used to refresh the body.

In short: the page renders correctly *everywhere*, and stays editable and re-runnable inside SilverBullet.

# Using baked sections
There are three actions:

- **Bake button** — block `${...}` widgets (tables, lists, diagrams) show a _Bake_ button in their hover toolbar, next to Copy. Click it to turn that live directive into a baked section in place.
- `Baked Sections: Update` (`Ctrl-Shift-b` / `Cmd-Shift-b`): re-evaluates *every* baked section on the current page and rewrites each body with its latest output. Run this whenever the underlying data changed and you want the baked output refreshed.
- `Baked Sections: Unbake Section At Cursor` — put your cursor inside a baked section and run this to turn it back into a live `${...}` directive. Handy when you want to edit the expression with [[Live Preview]] again, bake it back when you’re done.

Baking is **static and manual**: a baked section shows the output from the last time it was baked. It does not refresh by itself, re-run `Baked Sections: Update` to bring it current.

# Who is this for?
* **Sharing or publishing outside SilverBullet** ([[Share]], [[Export]]) — bake your dynamic pages so a published site, a GitHub repo, or a static export shows real tables and content instead of directive source.
* **Docs-as-code / shared repositories** — when teammates browse `.md` files on GitHub or in another editor, baked sections render natively for them, while you keep the live query in SilverBullet.

If your content never leaves SilverBullet, you don’t need baking, live `${...}` directives are simpler and less noisy. Baking is for when the *markdown itself* has to look right somewhere else or processed further.

# Good to know
* **Block-level only.** Baked sections wrap block content (a table, a list, a [[API/widget|widget]] such as a Mermaid diagram) on their own lines. Inline values in the middle of a sentence aren’t baked.
* **Needs a markdown renderer.** Anything with a markdown form bakes cleanly (values, query tables, widgets that expose markdown — including diagrams that emit a fenced ` ```mermaid ` blocks). A widget that can *only* render HTML has nothing portable to write, so it’s skipped (and the Bake button doesn’t appear on it).
* **The markers are just comments.** If a baked body somehow contains the literal closing marker, it’s automatically escaped so updating stays reliable.
