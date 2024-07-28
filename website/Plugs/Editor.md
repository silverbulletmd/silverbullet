#plug

The `editor` plug implements foundational editor functionality for SilverBullet.

# Commands

* {[Editor: Toggle Dark Mode]}: toggles dark mode
* {[Editor: Toggle Vim Mode]}: toggle vim mode, see: [[Vim]]
* {[Stats: Show]}: shows some stats about the current page (word count, reading time etc.)
* {[Help: Getting Started]}: Open getting started guide
* {[Help: Version]}: Show version number

## Pages
* {[Page: New]}: Create a new (untitled) page. Note that usually you would create a new page simply by navigating to a page name that does not yet exist.
* {[Page: Delete]}: delete the current page
* {[Page: Copy]}: copy the current page

## Navigation
* {[Navigate: Home]}: navigate to the home (index) page
* {[Navigate: To This Page]}: navigate to the page under the cursor
* {[Navigate: Center Cursor]}: center the cursor at the center of the screen
* {[Navigate: Move Cursor to Position]}: move cursor to a specific (numeric) cursor position (# of characters from the start of the document)
* {[Navigate: Move Cursor to Line]}: move cursor to a specific line, counting from 1; write two numbers (separated by any non-digit) to also move to a column, counting from 1.

## Text editing
* {[Text: Quote Selection]}: turns the selection into a blockquote (`>` prefix)
* {[Text: Listify Selection]}: turns the lines in the selection into a bulleted list
* {[Text: Number Listify Selection]}: turns the lines in the selection into a numbered list
* {[Text: Link Selection]}: turns the selection into a link.
  #ProTip You can can also select text and paste a URL on it via `Ctrl-v`/`Cmd-v` to turn it into a link)
* {[Text: Bold]}: make text **bold**
* {[Text: Italic]}: make text _italic_
* {[Text: Marker]}: mark text with a ==marker color==
* {[Link: Unfurl]}: “Unfurl” a link, see [[Link Unfurl]]

# Outlines
```template
page: "[[Outlines]]"
```
# Debug
Commands you shouldn’t need, but are nevertheless there:

* {[Debug: Reset Client]}: clean out all cached data on the client and reload
* {[Debug: Reload UI]}: reload the UI (same as refreshing the page)
* {[Account: Logout]}: (when using built-in [[Authentication]]) Logout

