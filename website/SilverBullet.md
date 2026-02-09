# Introduction
SilverBullet is a [[Programmable]], [[Private]], [[Browser]]-based, [[Open Source]], [[Self Hosted]], [[Personal]] [[Knowledge Management]] [[Platform]].

_Yowza!_ That surely is a lot of adjectives to describe a browser-based [[Markdown]] editor programmable with [[Lua]].

Let’s get more specific.

In SilverBullet you keep your content as a collection of [[Markdown]] [[Page|Pages]] (called a [[Space]]). You navigate your space using the [[Page Picker]] like a traditional notes app, or through [[Link|Links]] like a wiki (except they are [[Linked Mention|bi-directional]]).

If you are the **writer** type, you’ll appreciate SilverBullet as a clean [[Markdown]] editor with [[Live Preview]]. If you have more of an **outliner** personality, SilverBullet has [[Outlines|Outlining]] tools for you. Productivity freak? Have a look at [[Task|Tasks]]. More of a **database** person? You will appreciate [[Object|Objects]] and [[Space Lua/Lua Integrated Query|Queries]]. 

And if you are comfortable **programming** a little bit — now we’re really talking. You will love _dynamically generating content_ with [[Space Lua]] (SilverBullet’s [[Lua]] dialect), or to use it to create custom [[Command|Commands]], [[Page Template|Page Templates]] or [[API/widget|Widgets]].

# Programmable notes
Dynamically generating content, _programmable notes_... why would you want that, and how does it work?

Let’s say you have documented a set of product features in individual pages that you’ve [[Tag|tagged]] with a #feature tag, and annotated with a few custom [[Frontmatter]] [[Attribute|Attributes]].

With a simple [[Space Lua/Lua Integrated Query|Query]] and [[Template]], you can now dynamically build a product feature list, ordered by _awesomeness_ (`Alt-click` or hover and click the edit button to see the underlying code):

${template.each(query[[
  from tags.feature
  where tag == "page"
  order by awesomeness desc
]], templates.featureItem)}

_(The template generating the feature bullet items can be found in [[^Library/Website Templates]])_

Neat huh? A few more use cases.

## Active pages
Let’s say you want to have a list of your 5 modified pages. We can do that!
${template.each(query[[
  from tags.page
  order by lastModified desc
  limit 5
]], templates.pageItem)}

## To do items 
Maybe you want to collect all [[Task|Tasks]] that you have not yet completed from across your space? No problem:
${template.each(query[[
  from index.tag "task"
  where not _.done
  limit 3
]], templates.taskItem)}

# Tour
That all sounds nice, but what does that look like in practice? Well, if you’re wondering purely about _looks_: have a look around — this very website is hosted as a _read-only_ SilverBullet instance. You probably already figured this out.

If you’d like a bit of a tour and demo, give this a watch:
${embed.youtube "https://www.youtube.com/watch?v=mik1EbTshX4"}

Want to see even more? Here is a whole [playlist with instruction videos](https://www.youtube.com/watch?v=bb1USz_cEBY&list=PLxFAb_vXRcEp4465MVI6Ha9wzNiX5VevQ) that go more in depth.

# [[Install]]
As mentioned, SilverBullet is a [[Self Hosted]] web application. This is great if you care about [[Data Sovereignty]], but it does mean you need to [[Install]] it on a server yourself. Perhaps you do this on a Raspberry Pi you didn’t have a use for, or a VPS somewhere in the cloud. SilverBullet is distributed as a single self-contained server [[Install/Binary]] or [[Install/Docker]] container.

While this is a bit more complicated to set up than simply downloading desktop app or signing up for an account with some online service, self hosting is a path to both [[Data Sovereignty]] and to access your content from any device with a modern [[Browser]].

Ready? Proceed to [[Install]].

# [[Architecture]]
The SilverBullet client is built as a [[Local First]], [[PWA|Progressive Web Application]], syncing all your content into your browser’s local storage, enabling **instant access** to your entire space whether you are **online** or **offline**. Simply opt to “Install SilverBullet” from your browser (in any Chrome-based browser), add it to your Dock or home screen (Safari and Android), and voila: SilverBullet becomes indistinguishable from a regular desktop or mobile app. You can try it right here on silverbullet.md.
![[pwa-screenshot.png]]

Unplug your (hypothetical) network cable, and everything still works!

Learn more about SilverBullet’s technical [[Architecture]].

# Project status
SilverBullet has been in development since early 2022, but is ever evolving. The current iteration is **SilverBullet v2**. We had a little bit of a reboot, rebuilding some of the foundations, and replacing some of the previous ([v1](https://v1.silverbullet.md)) features. 

# What’s next?
* [[Manual]]: SilverBullet’s official manual.
* [[CHANGELOG]]: we’re in active development, so things change rapidly. Watch this page to keep up.
* [Community](https://community.silverbullet.md): join our community: ask questions, share your experiences.
* [Issues](https://github.com/silverbulletmd/silverbullet/issues): if you have ideas or find bugs, please report them.
* [Mastodon](https://fosstodon.org/@silverbulletmd): follow SilverBullet development on [Mastodon](https://joinmastodon.org/).
