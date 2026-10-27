---
description: "Inspect Space Lua scripts, their load order, errors and quarantine status."
references:
- client/workbench/scripts/**
---
The Scripts tab lists every `space-lua` block in your space, in the order SilverBullet loads them: by priority, highest first (see [[Space Lua#Definition loading]]).

${widgets.commandButton("Workbench: Scripts")} opens this tab in the [[Workbench]].

Each row shows:
* **Status:** a green dot when the script loaded, red when it failed, and amber when it’s quarantined.
* **Script:** the page it’s on. When a page holds several scripts, each row also shows the script’s position in the page, like `@66`.
* **Priority** and **Load:** its priority and how long running it took.

Scripts that failed to load show their error right below the row, with the same message, marked line and clickable stack as in the console. To narrow the list, use the filter field and two sets of buttons, each showing counts:

* **All**, **Custom** and **Built-in**: where scripts come from. Built-in scripts ship with SilverBullet, on `Library/Std` pages. Everything else is custom, including libraries you installed.
* **All**, **Loaded**, **Failed** and **Quarantined**: how loading went.

The footer shows how many scripts there are, how long loading them took in total, and when they last loaded.

Click a row to jump to the script.

A script is **quarantined** when you stop it for running too long while it loads. It’s then skipped on later loads until you use **Re-enable** in the quarantine notification banner, or until you edit it. A script you stopped during the current load also shows as quarantined. See [[Space Lua#Runaway scripts]].

**Reload** runs all your `space-lua` blocks again, and the list updates when they’re done.
