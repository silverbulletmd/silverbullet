---
description: "Run Lua in space or page context and inspect the unified runtime log."
references:
- client/workbench/console/**
---
A mix of logs (Lua, JavaScript, Plugs, Service Worker) and a Lua REPL. Enter Lua expressions, and they will be evaluated.

${widgets.commandButton("Workbench: Console")} opens this tab in the [[Workbench]].

# The log
The log collects:
* **Lua:** output of `print` in your scripts, with a link to the line that printed it, plus everything you run in the REPL.
* **JS:** anything SilverBullet’s own code writes to the browser’s console, plus uncaught errors.
* **Plug:** log lines from [[Plugs]], labeled with the plug’s name.
* **SW:** log lines from the service worker, which handles syncing and offline support. Lines it logs while no SilverBullet window is open are not shown.

The log keeps the most recent 1000 entries. Use the filter field to search them (a plug’s name matches too), and the **All**, **Lua**, **JS**, **Plug**, **SW** and **Error** buttons to show one source, or only errors.

Lua errors show their message, a hint when there is one, and the offending line with the failing part marked. **Stack** lists where the error passed through.

# The REPL
Type Lua at the bottom prompt at the bottom and press Enter to run it.

The REPL can operate in two “contexts”:
* Space context: in which only “space wide” (so technically, [[Space Lua]] variables are availbel).
* Page context: in which in addition to to space-wide, you also have access to [[Space Lua/Page Lua]] variables and functions declared in `page-lua` blocks.

What you can enter in the REPL:
* **Expressions** show their value: `1 + 2` shows `3`, and `"a", "b"` shows both values. A statement, like an assignment or a loop, shows nothing unless it ends with `return`.
* **Local variables:** a `local` you define stays available to later input, until you reload the page.
* **Multi-line input:** when a line is incomplete, like `function f()` or an open `{`, Enter starts a new line instead of running it. Shift-Enter always starts a new line.
* **History:** Up and Down step through earlier input. History is kept in your browser, except with client-side encryption enabled, where it only lasts until you reload.
* **Completion:** suggestions appear as you type names, with documentation for API functions.

# Results
Results that are tables, lists or records render the way a `${…}` expression would render them on a page: query results as tables, widgets as widgets. Use the **Rendered** and **Lua** toggle on a result to switch to the underlying Lua value instead.

# Entry menu
Hover a log entry and click the three-dotted menu for options that depend on the entry type:

* **REPL input:** `Copy as ${…}` (for a single expression, so you can paste it into a page), *Copy code*, and *Run again* (using the entry’s original context).
* **Results:** *Copy as Markdown*, the same as on a `${…}` widget.
* **Errors:** *Copy error*.
* **Other entries:** *Copy text*.
