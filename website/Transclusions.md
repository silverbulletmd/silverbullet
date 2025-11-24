Transclusions are an extension of the [[Markdown]] syntax enabling inline embedding of content.

The general syntax is `![[path]]`. Two types of transclusions are currently supported:

# Media
Syntax: `![[path/to/image.jpg]]` see [[Document#Embedding]] for more details.

Media resizing is also supported:
![[Document#Media resizing]]
# Pages
Syntax:
* `![[page name]]` embed an entire page
* `![[page name#header]]` embed only a section (guarded by the given header)
