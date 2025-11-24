If you would like to export content (a full page or a selection), you can use SilverBullet’s _Export_ functionality triggered with ${widgets.commandButton "Export: Page Or Selection"}.

**Note:** Exports are one-offs. If you are interested in sharing content onto other platforms and keeping things in sync, have a look at [[Share]].

# Support
Out of the box SilverBullet ships with the following exporters:

* Copy rich text: e.g. for pasting into a Google Docs or some other WYSIWYG environment.
* Copy clean markdown: stripping SilverBullet-specific markdown and rendering e.g. [[Space Lua#Expressions]]: e.g. to paste into a Github issue or other markdown friendly platform.

The export infrastructure as well as the above exporters are implemented in Space Lua here: [[^Library/Std/Infrastructure/Export]]. If you would like to implement your own exporters, have a look at the built-in ones to understand how they work.