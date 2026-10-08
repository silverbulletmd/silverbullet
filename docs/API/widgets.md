---
tags: api/space-lua
references:
- libraries/Library/Std/Widgets/Widgets.md
- client/styles/_std_widgets.scss
---
Ready-made widgets for pages, dashboards and overviews: buttons, sub-page lists, and visual building blocks (chips, bars, number cards and grids). Use them in a [[Space Lua#Expressions|${...} expression]] or return them from a [[API/widget#Live widgets|live widget]]'s `content`. They are built with the [[API/dom|DOM builder]] and implemented in [[^Library/Std/Widgets/Widgets]].

# Tones
The visual widgets color by meaning to make theming easier. The same colours are available to your own CSS as `--tone-<name>` and `--tone-<name>-soft`, see [[Space Style#Tone colours]].

For a colour no tone covers, pass `color` with any CSS colour (`"#c0603a"`, `"teal"`, `"rgb(40 120 90)"`) instead: the widget uses that colour, with a light tint of it as the background, and `color` wins over `tone`. A literal colour stays the same in light and dark mode, so check it in both; prefer a tone where one fits. An invalid colour is ignored and the tone applies.

${widgets.chip("info", { tone = "info" })} ${widgets.chip("#c0603a", { color = "#c0603a" })} ${widgets.chip("teal", { color = "teal" })}

# Clicks
`widgets.chip`, `widgets.stat` and `widgets.bars` take an `onClick` function. With it, the element becomes clickable. For `widgets.bars` the function receives the row that was clicked. To open a page, navigate in the callback, e.g.:

```lua
widgets.chip("Harbor", {
  onClick = function()
    editor.navigate("Projects/Harbor") 
  end
})
```

All text the widgets show (labels, values, captions) is shown literally: `**bold**`, `<b>`, `[[links]]` and `${...}` are not interpreted.

# API
## widgets.button(text, callback, attrs?)
A button that runs `callback` when clicked. `text` is shown literally. `attrs` adds attributes to the `<button>` element (see [[API/dom]]).

${widgets.button("Say hi", function()
  editor.flashNotification "Hi there!"
end)}

## widgets.commandButton(commandName) / widgets.commandButton(text, commandName, args?)
A button that runs a [[Command|command]]. With one argument, the command name is also the label; `args` is a list of arguments passed to the command.

${widgets.commandButton("Reload", "System: Reload")}

## widgets.subPages(pageName?)
A list of the pages below `pageName` (default: the current page).

## widgets.chip(label, opts?)
A small rounded label, shaped like a hashtag, for statuses and categories. Inline.

| Option | Effect |
| --- | --- |
| `tone` | Tone name; default `neutral`. An unknown name falls back to `neutral`. |
| `color` | A CSS colour, used instead of the tone. |
| `title` | Tooltip. |
| `onClick` | Function run when the chip is clicked. |

Examples:
${widgets.chip("shipped", { tone = "success" })} ${widgets.chip("blocked", { tone = "danger" })} ${widgets.chip("review", { tone = "info" })} ${widgets.chip("draft")}

## widgets.bars(rows, opts?)
Horizontal bars, one per row, for counts or a distribution. `rows` is a list of tables or a [[Space Lua/Integrated Query|query]] result. Each row shows its label, a bar whose length is the value relative to the maximum, and the value. Block-level.

| Option | Effect |
| --- | --- |
| `label` | Field name holding the label, or a function of the row; default `"label"`. |
| `value` | Field name holding the number, or a function of the row; default `"value"`. |
| `tone` | Tone name, or a function of the row returning one; default the row's own `tone` field, else `accent`. |
| `color` | A CSS colour, or a function of the row returning one, used instead of the tone; default the row's own `color` field. |
| `max` | The value that fills the whole width; default the largest value. |
| `onClick` | Function run with the row when it is clicked. |

${widgets.bars {
  { label = "Open", value = 7, tone = "warning" },
  { label = "Waiting", value = 3, tone = "info" },
  { label = "Closed", value = 12, tone = "success" },
}}

Over a query, with computed values:

```lua
widgets.bars(query[[
  from p = index.pages("project") order by p.name
]], {
  label = "name",
  value = function(p) return #query[[from t = index.tag "task" where t.page == p.name]] end,
  onClick = function(p) editor.navigate(p.name) end,
})
```

With no rows it shows "Nothing to show".

## widgets.stat(label, value, opts?)
A number card: a label, a large value and an optional caption and progress bar. 

| Option | Effect |
| --- | --- |
| `tone` | Colours the value and the bar; default `neutral` (plain text colour). |
| `color` | A CSS colour, used instead of the tone. |
| `sub` | Caption below the value. |
| `bar` | A fraction from 0 to 1, drawn as a thin progress bar (clamped). |
| `onClick` | Function run when the card is clicked. |

${widgets.stat("Tasks done", "8/20", {
  tone = "success",
  sub = "40% overall",
  bar = 0.4
})}

## widgets.grid(items, fn?, opts?)
Lays cells out side by side in columns: as many columns as fit across the page, each at least `opts.min` wide, wrapping onto more rows as the page narrows. Block-level.

`items` is the list you want one cell each for. It can be used in two ways:

* **Without `fn`, `items` are the cells.** Pass a list of ready-made widgets, and each becomes one cell.
* **With `fn`, `items` is data and `fn(item)` builds the cell for each item.** This is the usual way with a [[Space Lua/Integrated Query|query]]: `items` is the query result, and `fn` is called once per item and returns the widget for it.

A cell can be any widget (`widgets.stat`, `widgets.chip`, `widget.html(...)`), a [[API/dom|DOM element]], or a string or number (shown as literal text). Cells keep their own click handlers.

| Option | Effect |
| --- | --- |
| `min` | Minimum column width as a CSS length; default `12rem`. |

When you don't pass `fn`, the options can go second: `widgets.grid(cells, { min = "10rem" })`.

### Cells you build yourself
${widgets.grid {
  widgets.stat("Open", 7, { tone = "warning" }),
  widgets.stat("Closed", 12, { tone = "success" }),
  widgets.stat("Overdue", 2, { tone = "danger" }),
}}

### Data plus a function
The same grid from a list of data, with `fn` turning each entry into a card:

${widgets.grid({
  { label = "Open", count = 7, tone = "warning" },
  { label = "Closed", count = 12, tone = "success" },
  { label = "Overdue", count = 2, tone = "danger" },
}, function(s)
  return widgets.stat(s.label, s.count, { tone = s.tone })
end)}

### From a query
One card per page tagged `project`, each opening its page when clicked:

```lua
widgets.grid(query[[from p = index.pages("project") order by p.name]], function(p)
  return widgets.stat(p.name, p.status or "?", {
    sub = p.owner,
    onClick = function() editor.navigate(p.name) end,
  })
end)
```
