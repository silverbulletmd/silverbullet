## Getting started
The best way to get a good feel for what SilverBullet is to immediately start playing with it. Here are some things for you to try:

* Click on the page picker (book icon) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the **page switcher**.
  * Type the name of a non-existent page to create it.
  * You _can_ create pages in folders (if you’re into that type of thing) simply by putting slashes (`/`) in the name (even on Windows), e.g. `My Folder/My Page`. Don’t worry about that folder existing, we’ll automatically create it if it doesn’t.
* Click on the terminal icon (top right), hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows), or tap the screen with 3 fingers at the same time (on mobile) to open the **command palette**. The {[Stats: Show]} one is a safe one to try.
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` (Windows/Linux) to make it **bold**, or `Cmd-i` (Mac) or `Ctrl-i` (Windows/Linux) to make it _italic_.
* Click a link somewhere on this page to navigate there. When you link to a new page it will initially show up in red (to indicate it does not yet exist), but once you click it — you will create the page automatically (only for real when you actually enter some text).
* Start typing `[[` somewhere to insert your own page link (with completion).
* [ ] Tap this box 👈 to mark this task as done.
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* Hit `Cmd-p` (Mac) or `Ctrl-p` (Windows, Linux) to show a preview for the current page on the side.
* If this is matching your personality type, you can click this button {[Editor: Toggle Vim Mode]} to toggle Vim mode. If you cannot figure out how to exit it, just click that button again. _Phew!_

Notice that as you move your cursor around on this page and you get close to or “inside” marked up text, you will get to see the underlying [[Markdown]] code. This experience is what we refer to as “live preview” — generally your text looks clean, but you still can see what’s under the covers and edit it directly, as opposed to [WYSIWYG](https://en.wikipedia.org/wiki/WYSIWYG) that some other applications use. To move your cursor somewhere using your mouse without navigating or activating (e.g. a wiki, regular link, or a button) hold `Alt` when you click. Holding `Cmd` or `Ctrl` when clicking a link will open it in a new tab or window.

Hadn’t we mentioned [[Markdown]] yet? Yeah, that’s the markup language you’ll use to add that dash of markup to your documents. It’s pretty simple to learn if you don’t know it already.

You will notice this whole page section is wrapped in a strange type of block. This is a SilverBullet specific feature called a [[🔌 Directive]] (in this case `#use`). There are various types of directives, and while we’re not keeping score, likely the coolest ones are [[🔌 Directive/Query|queries]] — so you should definitely look into those.

Don’t believe me, check this out, here’s a list of (max 10) pages in your space ordered by last modified date, it updates (somewhat) dynamically 🤯. Create some new pages and come back here to see that it works:

<!-- #query page select name order by lastModified desc limit 10 -->
|name                     |
|-------------------------|
|CHANGELOG                |
|🔨 Development           |
|Server                   |
|Raspberry Pi Installation|
|STYLES                   |
|Getting Started          |
|Sandbox                  |
|SETTINGS                 |
|SilverBullet             |
|🔌 Core/Templates        |
<!-- /query -->

That said, the directive used wrapping this page section is `#use` which uses the content of another page as a template and inlines it. Directives recalculate their bodies in two scenarios:

1. When you load/switch to a page
2. When you explicitly run the {[Directives: Update]} command

In the case of `#use` this means the body will again be replaced with the page included, so don’t be surprised when whatever you just updated inside of this directive block will be undone later. Just sayin’. [[🔌 Directive|Directives]] are a powerful feature, so you should definitely look into them once you get comfortable with the basics.

Feel free to completely remove all content on this page and make it your own, it’s just to get you started.

## What next?
If you are a visual learner, you may [enjoy this introduction video on Youtube](https://youtu.be/VemS-cqAD5k).

Beyond that, you can find more information about SilverBullet on its official website. You have two ways to access it:

1. Through its [regular website link](https://silverbullet.md/)
2. Directly without leaving SilverBullet, through [[Cloud Links]], just click on this: [[SilverBullet]] (note that all of these will be read-only, for obvious reasons)

To keep up with the latest and greatest going-ons in SilverBullet land, keep an eye on the [[CHANGELOG]], and regularly update your SilverBullet instance (`silverbullet upgrade` if you’re running the Deno version). If you run into any issues or have ideas on how to make SilverBullet even awesomer (yes, that’s a word), [join the conversation on GitHub](https://github.com/silverbulletmd/silverbullet).