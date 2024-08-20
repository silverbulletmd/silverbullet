# Hello there!
Welcome to the wondrous world of SilverBullet. A world that once you discover and appreciate, you’ll never want to leave.

_One of us!_

Out of the box SilverBullet is fairly minimal in terms of functionality. To give you a good “first run” experience, we have preconfigured the [[Library/Core]] [[Libraries|library]] for you in your {[Navigate: Open SETTINGS|settings]}. All need to do is import it by pushing this button:

{[Libraries: Update]} 

Just push that button. You know you want to.

Just do it.

You can learn what you actually did later when you feel comfortable diving into [[Libraries]].

# Next steps
Now that you have some basics stuff in place, it’s time to start playing around a little bit.

* Click on the page picker (book icon) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the [[Page Picker]].
  * Type the name of a non-existent page to create it.
  * Folders are implicitly created by putting slashes (`/`) in the name (even on Windows), e.g. `My Folder/My Page`. Don’t worry about folders existing, we’ll automatically create them if they don’t.
* Click on the terminal icon (top right), or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows), or tap the screen with 3 fingers at the same time (on mobile) to open the [[Command Palette]]. From here you can run various useful and perhaps less useful [[Commands]]. The {[Stats: Show]} one is a safe one to try.
* Select some text and hit `Cmd-b` (Mac) or `Ctrl-b` (Windows/Linux) to make it **bold**, or `Cmd-i` (Mac) or `Ctrl-i` (Windows/Linux) to make it _italic_.
* Click a link somewhere on this page to navigate there. When you link to a non-existent page it will initially show up in orange (to indicate it does not yet exist), but once you click it — you will create the page automatically (only for real when you actually enter some text).
* Start typing `[[` somewhere to insert your own page link (with completion).
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a [[Slash Commands|slash command]].
* If this is matching your personality type, you can click this button {[Editor: Toggle Vim Mode]} to toggle Vim mode. If you cannot figure out how to exit it, just click that button again. _Phew!_

Notice that as you move your cursor around on this page and you get close to or “inside” marked up text, you will get to see the underlying [[Markdown]] code. This experience is what we refer to as [[Live Preview]] — generally your text looks clean, but you still can see what’s under the covers and edit it directly, as opposed to [WYSIWYG](https://en.wikipedia.org/wiki/WYSIWYG) that some other applications use. To move your cursor somewhere using your mouse without navigating or activating (e.g. a wiki, regular link, or a button) hold `Alt` when you click. Holding `Cmd` or `Ctrl` when clicking a link will open it in a new tab or window.

Hadn’t we mentioned [[Markdown]] yet? Yeah, that’s the markup language you’ll use to add that dash of markup to your documents. On top of baseline markdown, SilverBullet supports a number of [[Markdown/Extensions]] as well.

You will notice this whole page section is wrapped in a strange type of block. This is a SilverBullet specific feature called a [[Transclusions]], which embed another (sometime external) page into the existing one.

SilverBullet has more tricks up its sleeve, we are just getting started. Consider [[Live Queries]] which allow you to query [[Objects]] in your space easily. [[Live Templates]] are another source of 🤯.

As a quick taster, check this out: here’s a list of (max 5) pages in your space ordered by the date of last modification. It updates (somewhat) dynamically. Create some new pages and come back here to see that it works:

```query
page select name order by lastModified limit 5
```

## What next?
If you are a visual learner, you may [enjoy this introduction video on Youtube](https://www.youtube.com/watch?v=BbNbZgOwB-Y).

Beyond that, you can find more information about SilverBullet on its official website. You have two ways to access it:

1. Through its [regular website link](https://silverbullet.md/)
2. Directly without leaving SilverBullet, through [[Federation]], just click on this: [[SilverBullet]] (note that all of these will be read-only, for obvious reasons)

To keep up with the latest and greatest goings-on in SilverBullet land, keep an eye on the [[CHANGELOG]].

Got any more questions? Join our [community](https://community.silverbullet.md/).

Feel a bit more ready in this endeavor? If so, feel to remove [[Transclusions|transclusion]] that renders this on-boarding description. You’re on your own now.

You got this. We believe in you.
