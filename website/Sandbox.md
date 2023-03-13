What does SilverBullet look like? Well, have a look around. **You’re looking at it at this very moment!** 🤯

Note that what you’re looking at is not a fully functional version because the _back-end is read-only_. That said, it should give you some feel for what it’s like to use SB before making the commitment of running a single `deno` command (see here: [[SilverBullet]]) to download and run it locally in its fully functioning mode.

## Start playing
So, feel free to make some edits in this space. Don’t worry, you won’t break anything, nothing is saved (just reload the page to see).

Here are some things to try:

* Click on the page picker (folder tree) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the **page switcher**. Type the name of a nonexistent page to create it (although it won’t save in this environment).
* Click on the run button (top right) or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows) to open the **command palette** (note not all commands will work in this quasi read-only mode).
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` to make it **bold**.
* Click a link somewhere in this page to navigate there.
* Start typing `[[` somewhere to insert a page link (with completion).
* [ ] Tap this box 👈 to mark this task as done.
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* Hit `Cmd-p` (Mac) or `Ctrl-p` (Windows, Linux) to show a live preview for the current page on the side, if your brain doesn’t speak native Markdown yet.
* Open this site on your phone or tablet and… it just works!
* Are you using a browser with **PWA support** (e.g. any Chromium-based
  browser)? Click on that little icon to the right of your location bar that says “Install SilverBullet” to give SB its own window frame and desktop icon, like it is a stand-alone app (not particularly useful on silverbullet.md, but definitely do this once you install it yourself).

Oh yeah, you can use fancy things like tables:

| Page | Comment |
|----------|----------|
| [[SilverBullet]] | Main product page |
| [[CHANGELOG]] | The latest updates |

or code snippets, like JavaScript:

```javascript
function helloWorld() {
   return "Hello there!"
}
```

or YAML:

```yaml
name: SilverBullet
rating: 5
```

Click into any of these and edit them.

There are a few features you don’t get to fully experience in this environment, because they rely on a working back-end, such as:

* Using SB’s powerful page indexing and **query mechanism** where part of pages are automatically rendered and kept up to date by querying various data sources (such as pages and their metadata, back links, tasks embedded in pages, and list items) with an SQL like syntax, rendered with handlebars templates.
* Intelligent **page renaming**, automatically updating any pages that link to it.
* **Full text search**.
* **Extending** and updating SB’s functionality by installing additional [[🔌 Plugs]] (SB parlance for plug-ins) and writing your own.

That’s all, now go install this baby already!

Instructions here 👉 [[SilverBullet]]
