---
description: "Inspect Space Style blocks, their load order and parsed CSS rules."
references:
- client/workbench/styles/**
---
The Styles tab lists every `space-style` block in your space (see [[Space Style]]), in the order they’re applied: by priority, highest first, after the blocks that set no priority.

${widgets.commandButton("Workbench: Styles")} opens this tab in the [[Workbench]].

Each row shows:

* **Status:** a green dot when the browser parsed the block’s CSS, and amber when the block holds CSS the browser parsed no rules from.
* **Style:** the page it’s on, with the block’s position in the page when the page holds several.
* **Priority** and **Rules:** its priority (“–” when it sets none) and how many rules the browser parsed from it.

Browsers drop CSS they can’t parse without reporting it, so an amber row almost always means a syntax error, like a missing `{`. A block that only holds comments isn’t flagged. A typo that breaks just one rule in a block shows up only as that block’s rule count being one lower than you’d expect.

The filter field and the **All**, **Custom** and **Built-in** buttons narrow the list, the same as on the [[Workbench/Scripts|Scripts]] tab, and it starts on **Custom** too. The footer shows how many styles there are, how many rules they add up to, and when they last loaded.

Click a row to jump to the style. **Reload** applies all styles again and updates the list.
