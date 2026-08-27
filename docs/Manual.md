Welcome to the wonderful world of SilverBullet. The goal of this manual is to give you a broad sense of how to use this tool and what it’s capable of. However, its full capabilities are yet to be discovered. You too may find new and creative ways to use the various SilverBullet features in ways nobody previously thought of.

However, that is all unlikely to happen unless you understand what SilverBullet can actually do. So let's give you a bit of a sense.

# Videos
Are you a visual learning? Give these videos a watch:

${embed.youtube "https://youtu.be/bb1USz_cEBY"}
${embed.youtube "https://youtu.be/7hyLvEfw34w"}
${embed.youtube "https://youtu.be/bZ79-RbyNoU"}
${embed.youtube "https://www.youtube.com/watch?v=Of7zE0AVApc"}
${embed.youtube "https://www.youtube.com/watch?v=cH9cs8fowhY"}
${embed.youtube "https://youtu.be/qkLJ3viVq8I"}
# Getting started
Start with [[Install]], followed by [[Getting Started]]. These will walk through the basics.

# Guides
Practical walkthroughs for common workflows:
${query[[from g = index.pages("guide") select templates.pageItem(g)]]}

# Installation and deployment
* [[Install]]: Installation instructions for various setups
* [[Feature/Authentication]]: Securing your instance
* [[TLS]]: the part where we walk through options to expose SilverBullet via HTTPS.
* [[Troubleshooting]]: When things don't go as planned
* [[Feature/CLI]]: Command-line interface for interacting with SilverBullet

For additional guides, check out [our community guides](https://community.silverbullet.md/c/guides/6).

# Core Concepts
These are the core concepts used in SilverBullet (also see the [[Glossary]]):
* [[Concept/Space]]
* [[Concept/Page]] (and [[Concept/Meta Page]])
  * [[Concept/Frontmatter]]
* [[Concept/Link]]
* [[Concept/Document]]
* [[Concept/Folder]]
* [[Concept/Library]]
* [[Feature/Collaboration]]
* [[Feature/Revisions]]

# User interface
SilverBullet’s UI is minimalist by design. Let’s look at the few UI elements and how to use them.

* The [[Concept/Top Bar]] contains:
  * [[Feature/Page Namer]]
  * [[Concept/Index Page]] (the home button)
  * [[Feature/Page Picker]]
  * [[Feature/Command Palette]]
* The main [[Feature/Editor]] component contains your currently selected page’s text

# Editing and Formatting
* Content is written using [[Markdown]] and rendered using [[Feature/Live Preview]]
  * Markdown [[Markdown/Basics]]
  * Markdown [[Markdown/Extensions]]
    * [[Concept/Link]]
    * [[Markdown/Admonition]]
    * [[Concept/Task]]
    * [[Markdown/Syntax Highlighting]]
    * [[Markdown/Comment]]
    * [[Markdown/Fenced Code Block]]
* [[Concept/Slash Command]]
* [[Concept/Outline]]
* [[Feature/Completion]]

# Navigation
The main ways to roam your space, beside following page links, are:

* [[Feature/Page Picker]]
* [[Feature/Meta Picker]]
* [[Feature/Tag Picker]]
* [[Feature/Full Text Search]]

# Advanced topics
* [[Object]]
  * [[Concept/Frontmatter]]
  * [[Concept/Attribute]]
* [[Space Lua]]
  * [[Space Lua/Standard Library]]
  * [[Space Lua/Integrated Query]]
  * [[Space Lua/DOM]]
  * [[Space Lua/JavaScript Interop]]
* [[Concept/Template]]
* [[Feature/Virtual Pages]]
* [[Concept/Library]]
* [[Troubleshooting]]

# Customization
* [[Feature/Configuration Manager]]
* [[Concept/Keyboard Shortcuts]]
* [[Concept/Page Decoration]]
* [[Concept/Space Style]]

# Extending SilverBullet
SilverBullet’s implementation is built on three things:

* The core is implemented as a TypeScript-based web app
* A lot of core functionality is implemented in [[Plugs]].
* An increasing amount of additional functionality is now being implemented in “native” [[Space Lua]].

See [[Feature/Extensions]] for an overview.

# Contributing
SilverBullet is free and open-source software. You can contribute to
it [via Github](https://github.com/silverbulletmd/silverbullet). For some details on how to do this, have a look
at [[Development]]. Another way to contribute is through [[Funding]].
