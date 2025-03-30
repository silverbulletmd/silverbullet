Some pointers on how to migrate from v1 to v2:

# Queries
v2 does not have support for old-style [queries](https://v1.silverbullet.md/Query%20Language) (live queries) anymore. They have been replaced with [[Space Lua/Lua Integrated Query]]. Give the linked page a read, but generally there’s a few differences:

1. Lua Integrated Queries tend to start with `from index.tag "tag-name"` instead of plain `tag-name`. This is a bit longer, but since whatever comes after `from` is a Lua expression, you can not just query [[Objects]], you can query any Lua table as well in the same way.
2. In the old query language, you access attribute simply by their name, this works in LIQ too, but stylistically it’s nicer to use either `_.attribute`, or to give the object you’re iterating over a name, using `from page = index.tag "page"`, for instance.
3. The `=` equals operator is `==` in Lua 😄

# Templates
In v1 there were various types of templates:

* [Live Templates](https://v1.silverbullet.md/Live%20Templates) (in `template` blocks)
* [Live Template Widgets](https://v1.silverbullet.md/Live%20Template%20Widgets) (using special [[Frontmatter]]-based hooks)
* [Snippets](https://v1.silverbullet.md/Snippets) (using special [[Frontmatter]]-based hooks)
* [Page Templates](https://v1.silverbullet.md/Page%20Templates) (using special [[Frontmatter]]-based hooks)

_Live templates_ are now better expressed by simply putting `${lua expressions}` in text. Iterating and rendering queries using templates is generally done using the `${template.each(query[[...]], someTemplateExpression)}` pattern.

_Live Template Widgets_ can now be implemented using an event listener:
```lua
event.listen {
  name = "hooks:renderTopWidgets", -- or hooks:renderBottomWidgets
  run = function(e)
    return widget.new {
      markdown = "Showing up at the top"
    }
  end
}
```

See [[^Library/Std/Widgets]] for some examples.

_Snippets_ can be implemented using the `slashcommand.define` API:

```space-lua
slashcommand.define {
  name = "my-snippet",
  run = function()
    editor.insertAtCursor("Hello world!")
  end
}
```

See [[^Library/Std/Slash]] for more examples.

_Page templates_ still need to be figured out, you can [chime in here](https://community.silverbullet.md/t/page-templates-in-v2/2037).

# Plugs
Many existing plugs _should_ keep working, but some may need updating.
However, since Space Config is removed. You now specify the plugs you like to use with Space Lua + the [[API/config]] API:

```lua
config.set("plugs", {
  "github:joekrill/silverbullet-treeview/treeview.plug.js"
})
```

After which you run the `Plugs: Update` to download and/or update them. `Plugs: Add` has not been (re)implemented, so you have to do this in code.

# Removed features
Certain features have been removed:

* Online mode: v2 is sync mode only, meaning all your content will be synced into your browser. A simpler Online mode may be added back later. If you like to wipe your local content at any time, use the `System: Wipe Client` command.
* [Federation](https://v1.silverbullet.md/Federation)
* [Share](https://v1.silverbullet.md/Plugs/Share) replaced by [[^Library/Std/Export]]
* [Libraries](https://v1.silverbullet.md/Libraries): will likely be replaced by [[^Library/Std/Import]].
* Space Script: replaced by [[Space Lua]]
* Space Config: replaced by the [[API/config]] APIs.
* Command link syntax (`{[...]})`) replaced by the `${widgets.commandButton(...)}` API.
