# Hello there!
Welcome to the wondrous world of SilverBullet. A world that once you discover and appreciate, you’ll never want to leave.

_One of us!_

Out of the box SilverBullet is fairly minimal in terms of functionality. To give you a good “first run” experience, we recommend you start by importing the [[Library/Core]] library into your space. This will give you a couple of useful pages, slash commands, page templates and widgets such as [[Table of Contents]] and [[Linked Mentions]] to start of with. If you have no idea what those are — don’t worry about it. Just keep going, you’ll get the hang of things.

Just push this button: {[Library: Import|Import Core Library]("!silverbullet.md/Library/Core/")}

You know you want to.

Just do it.

# Next steps
Now that you have some basics stuff in place, it’s time to start playing a bit.

* Click on the page picker (book icon) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the [[Page Picker]].
  * Type the name of a non-existent page to create it.
  * Folders are implicitly created by putting slashes (`/`) in the name (even on Windows), e.g. `My Folder/My Page`. Don’t worry about folders existing, we’ll automatically create them if they don’t.
* Click on the terminal icon (top right), or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows), or tap the screen with 3 fingers at the same time (on mobile) to open the [[Command Palette]]. From here you can run various useful and perhaps less useful [[Commands]]. The {[Stats: Show]} one is a safe one to try.
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` (Windows/Linux) to make it **bold**, or `Cmd-i` (Mac) or `Ctrl-i` (Windows/Linux) to make it _italic_.
* Click a link somewhere on this page to navigate there. When you link to a new page it will initially show up in red (to indicate it does not yet exist), but once you click it — you will create the page automatically (only for real when you actually enter some text).
* Start typing `[[` somewhere to insert your own page link (with completion).
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* If this is matching your personality type, you can click this button {[Editor: Toggle Vim Mode]} to toggle Vim mode. If you cannot figure out how to exit it, just click that button again. _Phew!_

Notice that as you move your cursor around on this page and you get close to or “inside” marked up text, you will get to see the underlying [[Markdown]] code. This experience is what we refer to as “live preview” — generally your text looks clean, but you still can see what’s under the covers and edit it directly, as opposed to [WYSIWYG](https://en.wikipedia.org/wiki/WYSIWYG) that some other applications use. To move your cursor somewhere using your mouse without navigating or activating (e.g. a wiki, regular link, or a button) hold `Alt` when you click. Holding `Cmd` or `Ctrl` when clicking a link will open it in a new tab or window.

Hadn’t we mentioned [[Markdown]] yet? Yeah, that’s the markup language you’ll use to add that dash of markup to your documents. It’s pretty simple to learn if you don’t know it already.

You will notice this whole page section is wrapped in a strange type of block. This is a SilverBullet specific feature called a [[Live Templates]], which embeds another (sometime external) page into the existing one. If you hover over this section, you’ll notice a small _refresh_ and _edit_ button. Hit that edit button to reveal the underlying source that renders this content.

SilverBullet has even more tricks up its sleeve. Consider [[Live Queries]] which allow you to query [[Objects]] in your space easily.

Don’t believe me? Check this out, here’s a list of (max 10) pages in your space ordered by name, it updates (somewhat) dynamically 🤯. Create some new pages and come back here to see that it works:

```query
page select name order by name limit 10 
```

## What next?
If you are a visual learner, you may [enjoy this introduction video on Youtube](https://www.youtube.com/watch?v=BbNbZgOwB-Y).

Beyond that, you can find more information about SilverBullet on its official website. You have two ways to access it:

1. Through its [regular website link](https://silverbullet.md/)
2. Directly without leaving SilverBullet, through [[Federation]], just click on this: [[SilverBullet]] (note that all of these will be read-only, for obvious reasons)

To keep up with the latest and greatest goings-on in SilverBullet land, keep an eye on the [[CHANGELOG]].

Got any more questions? Join our [community](https://community.silverbullet.md/).

Feel a bit more ready in this endeavor? If so, feel to remove the [[Live Templates|live template]] that renders this on-boarding description. You’re on your own now.

You got this.