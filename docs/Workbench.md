---
description: "The panel where you shape and understand your space: browse your objects and build queries over them, a Lua console with a unified log, and overviews of your space-lua scripts and space-style styles."
references:
- client/workbench/*
- client/navigator/views/workbench.ts
---
The workbench is where you shape and understand your space: look through your data, build queries over it, try out [[Space Lua]], and see how your scripts and styles loaded.

You can open the panel via ${widgets.commandButton("Workbench: Toggle")}.

Ultimately it will contain many things, but for now it covers the following:

* [[#Query]]: browse the objects in your space, and shape them into a [[Space Lua/Integrated Query|query]] without writing it, then put it on a page.
* [[#Console]]: everything your space logs, plus a [[Space Lua]] REPL.
* [[#Scripts]]: every `space-lua` block in your space, and how loading it went.
* [[#Styles]]: every `space-style` block in your space, and whether the browser could make sense of it.

# Opening the workbench
The workbench is a panel that opens at the bottom of the window. Like other panels, you can drag its top edge to resize it, and move it to the left or right sidebar, or open it as a large modal window, with its dock menu. On a phone it takes the full height of the screen instead, apart from a strip of your page. These commands open it:

* ${widgets.commandButton("Workbench: Toggle")} (Cmd-Alt-j on Mac, Ctrl-Alt-j elsewhere): opens the workbench, focuses it when it’s open but you’re working elsewhere, and closes it when it already has focus.
* ${widgets.commandButton("Workbench: Query")}, ${widgets.commandButton("Workbench: Console")}, ${widgets.commandButton("Workbench: Scripts")} and ${widgets.commandButton("Workbench: Styles")}: open the workbench on that tab, or switch an open workbench to it. These never close the panel.
* The `/Query…` slash command, typed in a page: opens the [[#Query]] tab with its query editor showing, to build a query that goes where you typed it.

It opens on Query the first time, and after that on the tab you last picked. Switching tabs keeps each tab’s state, such as a half-typed line in the REPL.

# Console
A mix of logs (Lua, JavaScript, Plugs, Service Worker) and a Lua REPL. Enter Lua expressions, and they will be evaluated and render their results inline. Each line has a context menu with relevant actions.

## The log
The log collects, from the moment SilverBullet starts:

* **Lua:** output of `print` in your scripts, with a link to the line that printed it, plus everything you run in the REPL.
* **JS:** anything SilverBullet’s own code writes to the browser’s console, plus uncaught errors.
* **Plug:** log lines from [[Plugs]], labeled with the plug’s name.
* **SW:** log lines from the service worker, which handles syncing and offline support. Lines it logs while no SilverBullet window is open are not shown.

The log keeps the most recent 1000 entries. Use the filter field to search them (a plug’s name matches too), and the **All**, **Lua**, **JS**, **Plug**, **SW** and **Error** buttons to show one source, or only errors. **Clear** empties the log.

Lua errors show their message, a hint when there is one, and the offending line with the failing part marked. **Stack** lists where the error passed through. Each location is a link: it jumps the editor to that spot in your page, or, when it points into earlier REPL input, scrolls the log to that input.

## The REPL
Type Lua at the `›` prompt at the bottom and press Enter to run it.

* **Expressions** show their value: `1 + 2` shows `3`, and `"a", "b"` shows both values. A statement, like an assignment or a loop, shows nothing unless it ends with `return`.
* **Local variables:** a `local` you define stays available to later input, until you reload the page. Everything else resolves against your space’s environment, so the functions your `space-lua` blocks define are available, and keep working after you edit and reload them.
* **Multi-line input:** when a line is incomplete, like `function f()` or an open `{`, Enter starts a new line instead of running it. Shift-Enter always starts a new line.
* **History:** Up and Down step through earlier input. History is kept in your browser, except with client-side encryption enabled, where it only lasts until you reload.
* **Completion:** suggestions appear as you type names, with documentation for API functions. Ctrl-Space lists everything available.

## Results
Results that are tables, lists or records render the way a `${…}` expression would render them on a page: query results as tables, widgets as widgets. Use the **Rendered** and **Lua** toggle on a result to switch to the underlying Lua value instead.

## Entry menu
Hover a log entry and click ⋯ for actions that fit it:

* **REPL input:** `Copy as ${…}` (for a single expression, so you can paste it into a page), *Copy code*, and *Run again*.
* **Results:** *Copy as Markdown*, the same as on a `${…}` widget.
* **Errors:** *Copy error*.
* **Other entries:** *Copy text*.

# Scripts
The Scripts tab lists every `space-lua` block in your space, in the order SilverBullet loads them: by priority, highest first (see [[Space Lua#Definition loading]]). Each row shows:

* **Status:** a green dot when the script loaded, red when it failed, and amber when it’s quarantined.
* **Script:** the page it’s on. When a page holds several scripts, each row also shows the script’s position in the page, like `@66`.
* **Priority** and **Load:** its priority and how long running it took.

Scripts that failed to load show their error right below the row, with the same message, marked line and clickable stack as in the console. To narrow the list, use the filter field and two sets of buttons, each showing counts:

* **All**, **Custom** and **Built-in**: where scripts come from. Built-in scripts ship with SilverBullet, on `Library/Std` pages. Everything else is custom, including libraries you installed. The list starts on **Custom**.
* **All**, **Loaded**, **Failed** and **Quarantined**: how loading went. These counts follow the first choice, so with **Custom** picked, **Failed** counts only your own failed scripts.

The footer shows how many scripts there are, how long loading them took in total, and when they last loaded.

Click a row to jump to the script. Its ⋯ menu offers:

* *Open source*: the same as clicking the row.
* *Copy code*: copies the script’s source.
* *Re-enable and reload*: for a quarantined script, lifts the quarantine and loads your scripts again.

A script is **quarantined** when you stop it for running too long while it loads. It’s then skipped on later loads until you re-enable it, or until you edit it. A script you stopped during the current load also shows as quarantined. See [[Space Lua#Runaway scripts]].

**Reload** runs all your `space-lua` blocks again, and the list updates when they’re done.

# Styles
The Styles tab lists every `space-style` block in your space (see [[Space Style]]), in the order they’re applied: by priority, highest first, after the blocks that set no priority. Each row shows:

* **Status:** a green dot when the browser parsed the block’s CSS, and amber when the block holds CSS the browser parsed no rules from.
* **Style:** the page it’s on, with the block’s position in the page when the page holds several.
* **Priority** and **Rules:** its priority (“–” when it sets none) and how many rules the browser parsed from it.

Browsers drop CSS they can’t parse without reporting it, so an amber row almost always means a syntax error, like a missing `{`. A block that only holds comments isn’t flagged. A typo that breaks just one rule in a block shows up only as that block’s rule count being one lower than you’d expect.

The filter field and the **All**, **Custom** and **Built-in** buttons narrow the list, the same as on the [[#Scripts]] tab, and it starts on **Custom** too. The footer shows how many styles there are, how many rules they add up to, and when they last loaded.

Click a row to jump to the style. Its ⋯ menu offers *Open source* and *Copy CSS*. **Reload** applies all styles again and updates the list.

# Query
The Query tab shows the objects in your space: your pages, tasks, and everything you tagged. Pick a tag to look through its objects, and use the query editor beside them to narrow them down, sort or group them, or pick what to show: it builds a query without you knowing the query syntax. Close the editor with its ✕ to give the objects the whole tab, and bring it back with **Edit query**. The result updates as you go; when you like what you see, put the query on a page. Either way, the bar at the bottom shows the query it takes, so you can learn the syntax as you click.

The tab has three parts:

* **Tags**, on the left: the kinds of objects SilverBullet indexes itself (**Built-in**, such as `task` and `page`), then the tags used in your space (**Custom**). Type in the box at the top to narrow the list; Enter picks the first match and Escape clears it. Picking one starts a query on it. The tab first opens on pages.
* **The query editor**: one row per part of the query, named after the keyword it writes.
* **The results**, the largest part, kept up to date as your space’s scripts reload and its index finishes building, with the query as you left it: the objects, rendered the way the query renders on a page (or as Lua values). It shows the first 200 rows of a large result.

## Building a query
* **From:** the tag you picked. **Schema** lists every field of its objects (see [[#Fields]]).
* **Where:** filters, all of which must match. *+ Filter* picks a field, then an operator that suits its type: text can be matched exactly, by a part or by its start; numbers and dates can be compared, with *before today* and *after today* for dates; lists can contain a value; and any field can be required to exist or not. *+ Expression* takes any Lua condition instead, with completion. Click a filter to change it.
* **Group By:** one result per distinct value of a field (or combination of fields). The **Select** row then shows group columns: each is a group key or an aggregate of a field, like `count` or `avg`, including your own [[Space Lua/Integrated Query/Aggregating|aggregates]].
* **Order By:** the order, with directions named for the field’s type (*earliest first*, *A–Z*, *high to low*). Click an order to flip it. While grouping, you order by a group key or an aggregate column.
* **Select:** what each result shows.
  * **Table** (the default): a column per field the objects have. Remove, rename and reorder columns; a *Page link* column makes a field a link, and an *Expression* column computes its value.
  * **List:** one line per result, from a template your space defines in `templates` (such as tasks with their checkbox), or a *Custom template…* you write with the fields as `${name}`. Each template shows the description from the `---` comment above it, and the ones whose `@param` takes this tag’s objects come first.
* **Limit:** how many results, or all when empty.

## Fields
Fields come from the tag’s [[Schema]] when it has one, and from looking at up to 500 of its objects, which also finds fields a schema leaves out. For each field, **Schema** shows its type, where it came from (*built-in*, *declared* or *inferred*), how many objects have it, and some of its values.

For a tag without a schema, the type is worked out from the values: dates, page links and numbers are recognized, and a field with a few repeating values becomes *one of* those values, with a dropdown in filters. A field with values of different kinds is marked *mixed*. You can change a field’s type for this session; that only changes which filters are offered. *Copy as tag.define* copies the fields as a `tag.define` you can paste into a `space-lua` block to give the tag a declared schema.

Changing the tag, or a change that leaves a filter or column without its field, offers to undo it.

## Using the query
The bar at the bottom shows the query; *Show* expands it.

* **Insert at cursor** puts the `${query[[…]]}` in the page you’re editing, or where you typed `/Query…`. For a query you opened from a page, it’s **Update page**, which replaces that query, and keeps doing so as you change it further.
* **Copy** copies it.
* **Run in Console** runs it in the [[#Console]], where you can look at its result as Lua values.

## Editing a query on a page
To change a `${query[[…]]}` already on a page, choose *Edit in query builder* from its widget’s ⋯ menu, or put the cursor in it and run ${widgets.commandButton("Workbench: Edit Query")}. The query editor opens with the query taken apart into its rows: a filter the builder could have written becomes that filter again, and any other condition, order or column stays as Lua, in an *Expression*. The query keeps its own variable name, or none.

Some queries don’t fit the builder, and say why instead of opening: a query over something other than one `index.tag`, an `offset`, a `having`, grouping by anything but fields, an `order by` with `using`, or a select other than a table with named columns or a template.

