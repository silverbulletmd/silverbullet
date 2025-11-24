Meta pages are pages not core to your content, but function as a way to configure, or extend your [[Space]]. You can think of them as “tooling” pages. 

The most obvious examples are part of SilverBullet’s [[^Library/Std]] library and include generally useful [[Library/Std/Infrastructure/Slash Templates]]. 

If you use [[Space Lua]] or [[Space Style]], you may want to put those on separate pages and tag them as `#meta` as well, so they don’t mingle with your main content.

# How are meta pages identified?
Meta pages at a technical level are [[Page]] like any other, the only technical difference is that they are tagged with any tag _starting_ with `#meta`. This is picked up by the [[Page Picker]] and [[Meta Picker]].

# How do you link to meta pages?
You can link to a meta page like any other page, that is using the `[[page name]]` syntax. However, in the context of regular content, meta pages will not appear in auto complete. To get auto completion for meta pages, you can use the `[[^page name]]` caret syntax. More information: [[Link#Caret page links]].
