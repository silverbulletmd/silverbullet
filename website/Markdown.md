Markdown is a plain text formatting system [originally developed by John Gruber](https://daringfireball.net/projects/markdown/). It has since been standardized into [CommonMark](https://commonmark.org/), which is what SilverBullet uses (with [[Markdown/Extensions]]). While a bit more technical than [WYSIWYG](https://pl.wikipedia.org/wiki/WYSIWYG)-style editing (like MS Word), the nice thing about markdown is that it is a (relatively) easy-to-implement standard, and you can read files even without special tools (like SilverBullet). 

This means that _you will always have access to the content_ even if you switch tools. It also means that you can use multiple tools at the same time to edit these files. You don’t have to use SilverBullet exclusively.

There is a bit of a caveat here: Markdown is limited in certain ways, and various tools using markdown as the underlying file format (like SilverBullet) need features that are not directly supported by markdown. As a result, different tools introduce extensions to markdown that are not standard nor interoperable. While in some cases, these tools converge on particular pieces of syntax (such as the non-standard `[[page link]]` syntax), some level of divergence in the markdown that each tool supports is unavoidable. SilverBullet is complicit in this as well. It adds a few extensions that are not widely supported and assigns new meaning to certain markdown features to implement novel features. In its defense, all these features are optional. If you want to just write plain markdown, you can.

See [[Markdown/Extensions]] for more details on these SilverBullet-specific extensions.

More about markdown:

* [[Markdown/Basics]]: learn some the markdown basics
* [[Markdown/Extensions]]: learn about SilverBullet’s set of markdown extensions
* [[Markdown/Syntax Highlighting]]: languages that SilverBullet supports syntax highlighting for
