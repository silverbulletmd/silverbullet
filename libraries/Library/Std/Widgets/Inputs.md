---
description: Reusable input widgets (text, number, lists, chips with completion) for widgets and forms.
tags: meta/api
---
Input widgets for building your own forms and widgets, all in the `widgets` namespace and named `widgets.*Input`. Each function takes one options table and returns a DOM node, which you can put in `dom.*` trees and `widget.htmlBlock`. The widgets know nothing about pages or frontmatter: they show `value` and call `onChange` with the new value. The [[Library/Std/Widgets/Object Form|object form]] (frontmatter and data blocks) is built from them.

Options every input takes:

| option | meaning |
|---|---|
| `value` | the current value |
| `onChange(value)` | called with the new value when the user commits a change; `nil` means empty |
| `readOnly` | shows the value as plain text, with nothing to edit |
| `placeholder` | hint shown while empty (text-like inputs) |

# Example
A tag picker and a note field that flash what was picked:

```lua
local picked = {}

widget.htmlBlock(dom.div {
  widgets.tagsInput {
    value = picked,
    onChange = function(list)
      picked = list or {}
    end,
  },
  widgets.textInput {
    placeholder = "Note",
    onChange = function(text)
      editor.flashNotification("Note: " .. text)
    end,
  },
  dom.button { 
    onclick = function()
      editor.flashNotification("Tags: " .. table.concat(picked, ", "))
    end,
    dom.text("Show tags")
  },
})
```

# API

## widgets.textInput(opts)
A text field that wraps long values and grows to fit them. Enter commits, Shift-Enter inserts a newline. `onChange` receives the text.

`[[links]]` in the text show as links (click or tap to follow) while it isn't being edited; a click elsewhere in it edits the text. Typing `[[` completes pages and anchored objects: ArrowUp/ArrowDown, Enter or Tab inserts `[[Page]]` (or `[[$name]]`, closing the `]]` when needed), Esc closes the list. `links = false` turns both off. Read-only text shows its links too.

## widgets.numberInput(opts)
A number field. `onChange` receives a number, or `nil` when cleared. Text that isn't a number is ignored.

## widgets.booleanInput(opts)
A checkbox. `onChange` receives `true` or `false`.

## widgets.dateInput(opts)
A date field for a `YYYY-MM-DD` `value`, always shown as `YYYY-MM-DD` (never in the browser's locale format), with a calendar button that opens the browser's date picker. `onChange` receives the date as a `YYYY-MM-DD` string, or `nil` when the field is cleared. Typed text that isn't a real `YYYY-MM-DD` date is marked invalid (the reason shows as the field's tooltip) and not passed on.

## widgets.selectInput(opts)
A dropdown over `opts.options`, a list of values. `onChange` receives the picked value, or `nil` for the empty choice.

## widgets.listInput(opts)
A list of strings, one text field per item. Items show and complete `[[links]]` like `widgets.textInput` (`links = false` turns that off). Each item has a `widgets.menu` (Move up, Move down, Insert below, Remove), and "+ add item" appends one. Keys: Enter inserts an item below, Shift-Enter inserts a newline in the item, Backspace in an empty item removes it, Alt+ArrowUp and Alt+ArrowDown move the item. `onChange` receives the new list, or `nil` when it's empty.

## widgets.menu(opts)
A "..." context button that opens a context menu. `opts.items` is a list, or a function returning one when the menu opens, of:
* `{ label = …, onSelect = function() … end }`, plus optionally `disabled = true` with a `reason` (shown muted, the reason as tooltip; picking it flashes the reason) and `danger = true` (for Delete and the like);
* `{ header = "…" }`: a muted line that can't be picked;
* `{ separator = true }`.

`opts.title` is the button's tooltip; with `opts.keepFocus`, clicking the button leaves focus where it was (in a field being edited). The button shows when the mouse rests on the nearest element with class `sb-in-menu-owner` (after a moment, fading again once the mouse is still, like every ⋯ menu), when that element has focus, and always on touch screens. Keys: Enter or Space on the button opens it with focus on the first item; ArrowUp/ArrowDown move, Enter picks, Esc closes (and returns focus to the button when focus was in the menu). A click outside closes it. `widgets.openMenu(node)` opens a menu node the same way, e.g. for a keyboard shortcut.

```lua
dom.div {
  class = "sb-in-menu-owner",
  dom.text("Report"),
  widgets.menu {
    items = {
      { label = "Rename", onSelect = function() editor.flashNotification("Rename") end },
      { separator = true },
      { label = "Delete", danger = true, disabled = true, reason = "Reports are kept" },
    },
  },
}
```

## widgets.chipsInput(opts)
A list shown as chips, with a text field that completes. `onChange` receives the new list, or `nil` when it's empty. Extra options:

| option | meaning |
|---|---|
| `complete(prefix)` | returns options `{ value, label?, description? }`. Called on first focus (to warm a cache) and while typing; the input filters and ranks the result itself, so it may return everything |
| `allowNew` | Enter, space or comma turn typed text into a chip even without a matching option (default `true`) |
| `sigil` | shown before each chip and option label, such as `"#"` |
| `display(value)` | the text of a chip (default: the value) |
| `identify(value)` | what makes two values the same, to skip duplicates (default: the value) |
| `clean(text)` | turns typed text into a value, or `nil` to drop it (default: trimmed text) |
| `onOpen(value)` | called when a chip is clicked |
| `chipClass` | extra CSS class for chips |
| `max` | most chips; when full, a new pick replaces the last one |

Keys: ArrowUp and ArrowDown move through the options, Enter or Tab accept one, Escape closes the list, Backspace in the empty field removes the last chip.

## widgets.tagsInput(opts)
Chips for tag names, completing from the tags in the space. Values are tag names without `#`; clicking one opens its tag page.

## widgets.identitiesInput(opts)
Chips for `@names`, completing from known identities. Values are names without `@`; clicking one opens the Mention Inbox for that name.

## widgets.refInput(opts) and widgets.refListInput(opts)
One or a list of references (`"[[Page]]"`, `"[[$anchor]]"`), as chips completing from pages and anchored objects. `opts.tag` limits them to that tag. Clicking a chip navigates to its target.

## widgets.schemaInput(schema, opts)
Picks the input for a JSON Schema property and passes `opts` on (with `opts.schema` set): a registered format first, then `enum`, `ref` (`schema.ref()`), lists of refs, tags (`schema.tags()`), identities (`schema.identities()`), lists of strings, `date`, and the plain types. The schema's `description` becomes the input's tooltip.

## widgets.inputFormats
Inputs for custom string formats, by format name. `widgets.schemaInput` (and so the object form) uses one for any property with that `format`:

```lua
widgets.inputFormats.rating = function(opts)
  return dom.input {
    type = "range", min = "0", max = "5",
    value = tostring(opts.value or 0),
    disabled = opts.readOnly and "disabled" or nil,
    onchange = function(e) opts.onChange(tonumber(e.target.value)) end,
  }
end
```

# Implementation

The implementation is split across these pages:

${widgets.subPages()}

# Styles
The inputs' styles (the `sb-in-*` classes) ship with SilverBullet itself, so forms look right before a space is indexed. Override them from a `space-style` block.
