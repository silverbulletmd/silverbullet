The page picker functions as the primary way to navigate between [[Pages]], as well as a way to create new ones.

The page picker can be invoked by clicking the 📔 icon in the top bar, or by pressing `Cmd-k` on Mac, or `Ctrl-k` on Windows/Linux.

The main input is the **filter phrase** and can be used to narrow down the list of page results.

If the filter phrase contains `#tags` the results will be filtered based on matching those tags.

> **note** Note
> [[Templates]], even though technically regular pages, do not appear in the page picker. To navigate to them, use the [[Template Picker]] instead.

Pressing the `Enter` key will open/create the selected page. Pressing `Shift-Enter` will always open or create (if it doesn't already exist) the page _exactly matching_ the filter phrase. Therefore, if you intend to create a new page, simply type the name of the new page and hit `Shift-Enter`.

# Result ordering
When no filter phrase is entered, pages are ordered by either _last opened_, or _last modified_ date in descending order. This makes it convenient to switch between recently edited pages.

When entering a filter phrase, the best matches should appear closer to the top, however the second option will always be an option to create a new page with _exactly_ the page name entered as the filter phrase.

# Keyboard shortcuts
* `Enter`: selects the highlighted page from the list and navigate there. If that page is marked with “Create” it will create that page.
* `Shift-Enter`: navigate to the page entered in as the filter phrase.
* `Space`: with an empty filter phrase will attempt to do something intelligent:
  * If the currently opened page is nested in a [[Folders|folder]], it will auto complete the current folder name in its place.
  * If the currently opened page name starts with an emoji, it will complete that emoji in its place.
  * Otherwise, it will complete the full page name of the currently open page.
* `ArrowUp`/`ArrowDown`: move up and down the highlighted page list
* `PageUp`/`PageDown`: move up and down 5 entries in the page list in one go
* `Home`: moves to the start of the list
* `End`: moves to the end of the list
* `Escape`: closes the page picker UI

# Mouse/touch operation
You can obviously scroll and select an item from the list by clicking with the mouse, as well as close the page picker by clicking outside of it.

