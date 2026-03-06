Welcome to the wonderful world of SilverBullet. The goal of this manual is to give you a broad sense of how to use this tool and what it’s capable of. However, its full capabilities are yet to be discovered. You too may find new and creative ways to use the various SilverBullet features in ways nobody previously thought of.

However, that is all unlikely to happen unless you understand what SilverBullet can actually do. So let's give you a bit of a sense.

**New here?** Start with the [[Quick Start]], which will walk through the basics in just a few minutes.

# Guides
Practical walkthroughs for common workflows:

* [[Guide/Journaling]] — set up a daily journal
* [[Guide/Knowledge Base]] — build a personal knowledge base
* [[Guide/Task Management]] — track projects and tasks
* [[Guide/People Notes]] — keep track of people and conversations

# Videos
${embed.youtube "https://youtu.be/bb1USz_cEBY"}
${embed.youtube "https://youtu.be/7hyLvEfw34w"}
${embed.youtube "https://youtu.be/bZ79-RbyNoU"}
${embed.youtube "https://www.youtube.com/watch?v=Of7zE0AVApc"}
${embed.youtube "https://www.youtube.com/watch?v=cH9cs8fowhY"}
${embed.youtube "https://youtu.be/qkLJ3viVq8I"}

# Keeping up-to-date
* [[CHANGELOG]]: what’s new in SilverBullet? This page will give you the latest details. It’s worth monitoring this page.

# Installation and deployment
* [[Install]]: Installation instructions for various setups
* [[Authentication]]: Securing your instance
* [[TLS]]: the part where we walk through options to expose SilverBullet via HTTPS.
* [[Troubleshooting]]: When things don't go as planned

For additional guides, check out [our community guides](https://community.silverbullet.md/c/guides/6).

# Core Concepts
These are the core concepts used in SilverBullet:
* [[Glossary]]
* [[Space]]
* [[Page]] (and [[Meta Page]])
  * [[Frontmatter]]
  * [[Names]]
* [[Folder]]
* [[Document]]

# User interface
SilverBullet’s UI is minimalist by design. Let’s look at the few UI elements and how to use them.

* The [[Top Bar]] contains:
  * [[Page Namer]]
  * [[Index Page]] (the home button)
  * [[Page Picker]]
  * [[Command Palette]]
* The main [[Editor]] component contains your currently selected page’s text

# Editing and Formatting
* Content is written using [[Markdown]] and rendered using [[Live Preview]]
  * Markdown [[Markdown/Basics]]
  * Markdown [[Markdown/Extensions]]
    * [[Link]]
    * [[Markdown/Admonition]]
    * [[Task]]
    * [[Markdown/Syntax Highlighting]]
    * [[Markdown/Fenced Code Block]]
* [[Slash Command]]
* [[Outlines]]
* [[Completion]]

# Navigation
The main ways to roam your space, beside following page links, are:

* [[Page Picker]]
* [[Meta Picker]]
* [[Tag Picker]]
* [[Full Text Search]]

# Advanced topics
* [[Object]]
  * [[Frontmatter]]
  * [[Attribute]]
* [[Space Lua]]
  * [[Space Lua/Standard Library]]
  * [[Space Lua/Lua Integrated Query]]
  * [[Space Lua/DOM]]
  * [[Space Lua/JavaScript Interop]]
* [[Template]]
* [[Virtual Pages]]
* [[Library]]
* [[Troubleshooting]]

# Customization
* [[^Library/Std/Config]]
* [[Page Decorations]]
* [[Space Style]]
* [[Keyboard Shortcuts]]

# Extending SilverBullet
SilverBullet’s implementation is built on three things:

* The core is implemented as a TypeScript-based web app
* A lot of core functionality is implemented in [[Plugs]].
* An increasing amount of additional functionality is now being implemented in “native” [[Space Lua]].

See [[Extensions]] for an overview.

# Contributing
SilverBullet is free and open-source software. You can contribute to
it [via Github](https://github.com/silverbulletmd/silverbullet). For some details on how to do this, have a look
at [[Development]]. Another way to contribute is through [[Funding]].
