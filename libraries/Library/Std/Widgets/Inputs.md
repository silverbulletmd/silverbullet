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

`opts.title` is the button's tooltip; with `opts.keepFocus`, clicking the button leaves focus where it was (in a field being edited). The button shows when the nearest element with class `sb-in-menu-owner` is hovered or has focus, and always on touch screens. Keys: Enter or Space on the button opens it with focus on the first item; ArrowUp/ArrowDown move, Enter picks, Esc closes (and returns focus to the button when focus was in the menu). A click outside closes it. `widgets.openMenu(node)` opens a menu node the same way, e.g. for a keyboard shortcut.

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
```space-style
.sb-in-plain {
  display: block;
  min-width: 0;
  padding: 2px 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sb-in-text,
.sb-in-number,
.sb-in-date,
.sb-in-select {
  min-width: 0;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
}
.sb-in-text,
.sb-in-select { width: 100%; }
.sb-in-number { width: 100%; max-width: 16em; }
.sb-in-date-field {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  max-width: 16em;
}
.sb-in-date { flex: 1 1 auto; width: 100%; }
.sb-in-date.sb-in-invalid,
.sb-in-date.sb-in-invalid:hover,
.sb-in-date.sb-in-invalid:focus {
  border-color: var(--danger-color);
  color: var(--danger-color);
}
.sb-in-date-button {
  position: relative;
  display: inline-flex;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--subtle-color);
  cursor: pointer;
}
.sb-in-date-button:hover { border-color: var(--ui-surface-border-color); color: var(--root-color); }
/* The real date input, invisible over the calendar icon */
.sb-in-date-picker {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.sb-in-text {
  display: block;
  margin: 0;
  resize: none;
  overflow: hidden;
  line-height: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  field-sizing: content;
}
.sb-in-text:not(:focus):hover,
.sb-in-number:hover,
.sb-in-date:hover,
.sb-in-select:hover,
.sb-in-chips:hover {
  border-color: var(--ui-surface-border-color);
}
.sb-in-text:focus,
.sb-in-number:focus,
.sb-in-date:focus,
.sb-in-select:focus,
.sb-in-chips:focus-within {
  border-color: var(--text-field-focus-color);
  outline: none;
}
.sb-in-select option { background: var(--root-background-color); color: var(--root-color); }
.sb-in-text::placeholder,
.sb-in-number::placeholder,
.sb-in-chip-input::placeholder { color: var(--subtle-color); opacity: 0.6; }
.sb-in-boolean { margin: 0 6px; }

.sb-in-chips {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
}
.sb-in-chip-list { display: contents; }
.sb-in-chip {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  border-radius: 6px;
}
.sb-in-chip.sb-in-chip-link {
  background-color: var(--editor-wiki-link-page-background-color);
}
.sb-in-chip .sb-in-chip-label {
  overflow: hidden;
  padding: 0 4px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.sb-in-chip-link .sb-in-chip-label { color: var(--editor-wiki-link-page-color); }
.sb-in-chip .sb-in-chip-label:hover { text-decoration: underline; }
.sb-in-chip-input {
  flex: 1 1 6em;
  min-width: 4em;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}
.sb-in-x, .sb-in-more, .sb-in-add {
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--subtle-color);
  font: inherit;
  cursor: pointer;
}
.sb-in-x { padding: 0 4px 0 0; color: inherit; opacity: 0.6; }
.sb-in-x:hover, .sb-in-more:hover, .sb-in-add:hover { color: var(--root-color); opacity: 1; }

.sb-in-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 12em;
  max-width: min(26em, 85vw);
  margin-top: 2px;
  padding: 4px 0;
  border: 1px solid var(--modal-border-color);
  border-radius: 6px;
  background: var(--modal-background-color);
  color: var(--root-color);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}
.sb-in-dropdown[hidden] { display: none; }
.sb-in-menu { left: auto; right: 0; min-width: 9em; }
.sb-in-option {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 10px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.sb-in-option-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sb-in-option-description { flex-shrink: 0; color: var(--modal-selected-option-description-color, var(--subtle-color)); font-size: 0.9em; }
.sb-in-option:hover,
.sb-in-option.sb-in-selected {
  background: var(--modal-selected-option-background-color);
}

.sb-in-list { display: flex; flex-direction: column; width: 100%; min-width: 0; }
.sb-in-list-item { position: relative; display: flex; align-items: flex-start; min-width: 0; }
.sb-in-list-item .sb-in-text { flex: 1 1 auto; }
.sb-in-linkfield { position: relative; display: block; flex: 1 1 auto; min-width: 0; }
.sb-in-linktext { display: none; }
.sb-in-show-links > .sb-in-text { display: none; }
.sb-in-show-links > .sb-in-linktext {
  display: block;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
}
.sb-in-show-links > .sb-in-linktext:hover { border-color: var(--ui-surface-border-color); }
.sb-in-link { cursor: pointer; }
.sb-in-menu-root { position: relative; display: inline-flex; flex-shrink: 0; }
.sb-in-more { flex-shrink: 0; margin-top: 2px; opacity: 0; }
.sb-in-menu-owner:hover .sb-in-more,
.sb-in-menu-owner:focus-within .sb-in-more,
.sb-in-menu-open .sb-in-more,
.sb-in-more:focus { opacity: 1; }
/* No hover on touch screens: always show it */
@media (hover: none) {
  .sb-in-more { opacity: 0.6; }
}
/* Touch: small buttons get a 44px hit area without changing their size */
@media (hover: none), (pointer: coarse) {
  .sb-in-more, .sb-in-x, .sb-in-date-button { position: relative; }
  .sb-in-date-picker {
    inset: auto;
    left: 50%;
    top: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
  }
  .sb-in-more::before, .sb-in-x::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
  }
  /* A chip's × grows up, down and a little left, never past the chip's end
     into the input next to it */
  .sb-in-x::before {
    left: auto;
    right: 0;
    width: 28px;
    transform: translateY(-50%);
  }
}
.sb-in-menu-header {
  padding: 3px 10px 4px;
  color: var(--subtle-color);
  font-size: 0.85em;
  white-space: nowrap;
  cursor: default;
}
.sb-in-menu-separator { margin: 3px 0; border-top: 1px solid var(--ui-surface-border-color); }
.sb-in-option.sb-in-disabled { color: var(--subtle-color); opacity: 0.6; cursor: default; }
.sb-in-option.sb-in-danger { color: var(--danger-color); }
.sb-in-add { align-self: flex-start; padding: 0 6px; }
```
