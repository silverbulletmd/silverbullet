---
description: "Inspect Space Style blocks, their load order and parsed CSS rules."
aliases:
- Workbench/Styles
references:
- client/workbench/styles/**
---
The **Space Style** section of the [[Workbench/Code|Code]] tab lists every `space-style` block on a [[Tool Page]] in your space (see [[Space Style]]), in the order they’re applied: by priority, highest first, where no priority counts as 0, then by page name and position.

${widgets.commandButton("Workbench: Styles")} opens the [[Workbench]] on this section.

Each row shows:

* **Status:** a green dot when the browser parsed the block’s CSS, and amber when the block holds CSS the browser parsed no rules from.
* **Style:** the page it’s on, with the block’s position in the page when the page holds several.
* **Priority** and **Rules:** its priority (“–” when it sets none) and how many rules the browser parsed from it.

A block on a [[Theming|theme]] page is marked with its theme. Blocks of themes that aren’t active are greyed out and show “–” for rules. The footer counts them separately, as inactive.

Browsers drop CSS they can’t parse without reporting it, so an amber row almost always means a syntax error, like a missing `{`. A block that only holds comments isn’t flagged. A typo that breaks just one rule in a block shows up only as that block’s rule count being one lower than you’d expect.

The filter field and the **All**, **Custom** and **Built-in** buttons narrow the list, the same as in the [[Workbench/Code/Scripts|Space Lua]] section, and it starts on **Custom** too. The footer shows how many styles there are, how many rules they add up to, and when they last loaded.

Click a row to jump to the style. **Reload** applies all styles again and updates the list.
