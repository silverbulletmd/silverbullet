## Getting started
The best way to get a good feel for what SilverBullet is like to use, is to get your hands dirty (after washing your hands first, always wash your hands before touching a keyboard).

Here are some things for you to try _right now_:

* Click on the page picker (book icon) icon at the top right, or hit `Cmd-k` (Mac) or `Ctrl-k` (Linux and Windows) to open the **page switcher**.
  * Type the name of a non-existent page to create it.
  * You can pages in folders (if you’re into that type of thing) simply by putting slashes (`/`) in the name (even on Windows), e.g. [[My Folder/My Page]] (note that although you only see the last bit of the name in live preview, the page is in fact nested in a folder).
* Click on the terminal button (top right) or hit `Cmd-/` (Mac) or `Ctrl-/` (Linux and Windows) to open the **command palette** (note that not all commands will work in this mode). On mobile you can tap the screen with 3 fingers at the same time to open the command palette.
* Select some text and hit `Alt-m` to ==highlight== it, or `Cmd-b` (Mac) or `Ctrl-b` (Windows/Linux) to make it **bold**, or `Cmd-i` (Mac) or `Ctrl-i` (Windows/Linux) to make it _italic_.
* Click a link somewhere on this page to navigate there. When you link to a [[New Page]] it will initially show up in red (to indicate it does not yet exist), but once you click it — you will create the page automatically (only for real when you actually enter some text).
* Start typing `[[` somewhere to insert a page link (with completion).
* [ ] Tap this box 👈 to mark this task as done.
* Start typing `:party` to trigger the emoji picker 🎉
* Type `/` somewhere in the text to invoke a **slash command**.
* Hit `Cmd-p` (Mac) or `Ctrl-p` (Windows, Linux) to show a preview for the current page on the side.
* Click this button {[Editor: Toggle Vim Mode]} to toggle Vim mode

Note that as you move your cursor around on this page and you get close to or “inside” marked up text, you will get to see the underlying [[💭 silverbullet.md/Markdown|Markdown]] code, this is what we refer to as “live preview” — generally your text looks clean, but you still can see what’s under the covers. To move your cursor somewhere by mouse without navigating or activating (e.g. a wiki, regular link, or a button) hold `Alt` when you click.

Hadn’t we mentioned [[💭 silverbullet.md/Markdown|Markdown]] yet? Yeah, that’s the markup language you’ll use to markup your documents. It’s pretty simple to learn if you don’t know it already.

You will notice this whole page block is wrapped in a [[💭 silverbullet.md/%F0%9F%94%8C_Directive|Directive]] (in this case `#include`), which means that its content is automatically updated every time you run the {[Directives: Update]} command or navigate back to the page. In the case of `#include` this means the body will be replaced with the page included, so don’t be surprised when whatever you update inside of this directive block will be undone later. Just sayin’. [[💭 silverbullet.md/%F0%9F%94%8C_Directive|Directives]] are a powerful feature, so you should definitely look into them once you get comfortable with the basics.

Feel free to completely remove all content on this page and make it your own, it’s just to get you started.

## What next?
Generally, you can find more information about SilverBullet on its official website. You have two ways to access it:

1. Through its [regular website link](https://silverbullet.md/)
2. Directly, through your local SilverBullet instance using [[💭 silverbullet.md/Cloud Links]]: [[💭 silverbullet.md/Silver Bullet]] (note that all of these will be read-only, for obvious reasons)