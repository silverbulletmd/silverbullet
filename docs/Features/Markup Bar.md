---
description: "Editing buttons above the keyboard on phones, and in the selection bubble and ⋮ line menu on desktop."
tags: glossary
references:
- libraries/Library/Std/Config.md
- libraries/Library/Std/APIs/Markup Bar.md
- client/components/keyboard_bar.tsx
- client/codemirror/selection_bubble.ts
- client/codemirror/line_menu.ts
---
The markup bar offers you buttons for common edits, so you can format text, restructure outlines and run commands without remembering Markdown syntax or keyboard shortcuts. It shows up in three places, depending on your client.

# On phones and tablets
A bar of buttons sits above the on-screen keyboard (or along the bottom of the screen when you use a hardware keyboard). Scroll it sideways to see more buttons. The buttons change with where the cursor is.

# On desktop (web and app)
## The selection bubble
Select some text and a small bubble appears above it, with buttons for bold, italic, code, highlight, link to a page and link to a URL.

## The ⋮ line menu
Move the mouse over a line and a ⋮ handle appears beside it in the left margin. Click it for a menu of what you can do with that line.

# Turning it off
* **Per device**: run ${widgets.commandButton("Editor: Toggle Markup Bar")} to hide the bar above the keyboard, or on desktop the selection bubble and the line menu's entries. Run it again to bring them back. Widget menus and **Add tag** stay.
* **For the whole space**: in the Editor section of [[Workbench/Configuration|Configuration]], turn off the formatting bubble (`markupBar.selectionBubble`) or the ⋮ line handle (`markupBar.lineHandle`).

# Customizing
Each of the three places has its own list of buttons, which you can extend or replace from [[Reference/Space Lua]], and you can limit a button to where the cursor is (only in outlines, never in code, and so on). See [[API/markupBar]] for how.