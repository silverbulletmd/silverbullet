Analogous to [[Live Preview]], _Live Edit_ allows you to edit (for now: YAML) objects in a “fancy” UI in-place, propagating the edits you make back to where the object lives.

This feature is currently available for [[Frontmatter]] and [[Tag/data]] blocks.

On a page without frontmatter, a faint tag icon ("add tag") appears left of the first line while the mouse is over it. Clicking it adds frontmatter with an empty `tags:` key and puts the cursor in its tags field; undo removes the frontmatter again.

# Under the hood
An object's YAML is shown by a render hook from the object's [[API/tag|tag]]:
* `renderFrontmatter(pageMeta, ctx)` for a page’s frontmatter
* `renderDataBlock(object, ctx)` for each document of a data block.

The hook returns a widget. When the user changes something in it, the widget calls `ctx.set`, which writes a minimal edit to the YAML. The default hook for both is the [[^Library/Std/Widgets/Object Form|object form]], built from the [[API/widgets]]. You can write your own hook to show an object differently.

## The render context
`ctx`, the second argument of a render hook, is the widget’s handle on the object's YAML:

* `ctx.kind`: `"page"` (frontmatter) or `"data"` (a data block document).
* `ctx.values`: the parsed YAML values. Date-only timestamps are `YYYY-MM-DD` strings and timestamps with a time are ISO strings (both typed `date`); tags are not normalized.
* `ctx.types`: each key's YAML type: `string`, `number`, `boolean`, `date`, `null`, `array` or `object`.
* `ctx.keys`: the top-level keys, in YAML order.
* `ctx.readOnly`: `true` when the page can't be edited; don't offer edits then. The built-in form then also leaves out the schema properties the YAML doesn't have.
* `ctx.set(key, value)`: sets one top-level attribute, adding it at the end if it's new.
* `ctx.remove(key)`: removes one top-level attribute.
* `ctx.move(key, delta)`: moves a top-level attribute `delta` places (`-1` up, `1` down).

The first argument holds the same values as the [[Object Index]] would have them (for a page also `name` and `tags`, for a data object also `ref`, `tag`, `tags` and `page`). Use `ctx.values` and `ctx.types` when you need what is literally in the YAML, e.g. to tell a date from a string.

What you can rely on:
* `set`, `remove` and `move` find the object where it is in the page when they're called, so they keep working after edits above it.
* Each call is one undo step, and Cmd-Z/Ctrl-Z inside the widget undoes it.
* They raise an error when the object can't be found or the change would break its tag's [[Schema|schema]]. Wrap them in `pcall` to report it.
* While focus is inside the widget, it keeps showing what the user typed; it re-renders with the new YAML once focus leaves. A widget that opens a picker (`editor.filterBox`) and adds to its own DOM after it returns sets a `data-sb-keep` attribute on one of its elements while the picker is open, and removes it afterwards; until then it isn't re-rendered.
* To get to the YAML, the user presses Esc in an input (the cursor goes to the attribute of the nearest element with a `data-key` attribute) or picks **Edit source** from the ⋯ menu.
* The ⋯ menu of frontmatter also has **Delete**, which removes the whole frontmatter (one undo step).

## Example
A compact card for ` ```#contact ` data blocks, with an editable email and a checkbox:

```lua
tag.define {
  name = "contact",
  renderDataBlock = function(contact, ctx)
    local function save(key, value)
      local ok, err = pcall(ctx.set, key, value)
      if not ok then
        editor.flashNotification(tostring(err), "error")
      end
    end
    return widget.htmlBlock(dom.div {
      class = "contact-card",
      dom.strong { contact.name or "Unnamed" },
      dom.div {
        ["data-key"] = "email",
        widgets.textInput {
          value = ctx.values.email,
          placeholder = "email",
          readOnly = ctx.readOnly,
          onChange = function(text)
            save("email", text)
          end,
        },
      },
      dom.label {
        ["data-key"] = "active",
        widgets.booleanInput {
          value = ctx.values.active == true,
          readOnly = ctx.readOnly,
          onChange = function(checked)
            save("active", checked)
          end,
        },
        " active",
      },
    })
  end,
}
```

## Without a render hook
`ctx` only exists inside a render hook. Anywhere else (a command, a button, a query result) use [[API/object#object.update|object.update]], which `ctx` is built on: `object.update(object, { status = "done" })` changes attributes of an object from a query where it is written, with the same minimal edits, and its `remove` and `order` options do what `ctx.remove` and `ctx.move` do.
