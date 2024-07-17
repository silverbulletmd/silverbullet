Meta pages are pages not core to your content, but function as a way to configure your [[Spaces|space]]. You can think of them as “tooling” pages. 

The most obvious example is [[SETTINGS]], which is not really a page that you care about day-to-day, but only want to tweak when you’re working on your space as a tool. 

[[Templates]] are other examples. If you use [[Space Script]] or [[Space Style]], you may want to put those on separate pages and tag them as `#meta` as well, so they don’t mingle with your main content.

# How are meta pages identified?
Meta pages at a technical level are [[Pages]] like any other, the only technical difference is that they are either tagged with `#template` or `#meta`. This is picked up by the [[Page Picker]] and [[Meta Picker]].

# How do you link to meta pages?
You can link to a meta page like any other page, that is using the `[[page name]]` syntax. However, in the context of regular content, meta pages will not appear in auto complete. To get auto completion for meta pages, you can use the `[[^page name]]` caret syntax. More information: [[Links#Caret page links]].
