SilverBullet is a [[Malleable]], [[Private]], [[Open Source]] [[Knowledge Management System]] that you typically use as a [[Self Hosted|Self Hosted]] web app (although there are [[Install#Cloud|Cloud Hosted]] and [[Install/Desktop]] options as well).

SilverBullet is built on a few fundamental beliefs:

First, **knowledge ought to be kept in a format that will stand the test of time**: for this it uses [[Markdown]] (a simple text file format) augmented with other standard file formats (images, videos, PDFs), kept in a folder of files on disk. [[Revisions]] of these files are kept in [[Git]]. While SilverBullet offers a slew of fancy features, they are all layered on top of the old-fashioned files-on-disk concept. Or as we say in the [community](https://community.silverbullet.md/): **the truth is in the markdown**. This ensures that if the SilverBullet project were ever to disappear, little is lost: you can still access all your content with any other tool. Bonus: it also interoperates with _any_ other tool that can read and write text files.

Second, there is no **one-size-fits all for knowledge management**. Your  needs, ways of thinking, and workflows are going to be different than your neighbor’s. And they’re going to evolve over time. This also applies to [[Collaboration|Teams]] in need of a shared knowledge base: teams have their own ever evolving specific needs, conventions and workflows too. Therefore, a knowledge management system needs to be [[Malleable]] — it needs to be able to evolve to the user’s needs over time, without having to build (or vibe code) a custom system. SilverBullet does this by providing **solid fundamentals**, and offering **rich abilities to extend** on top.

Third, **you ought to be in control of your data**. Call it [[Data Sovereignty]], position it as a focus on [[Private|Privacy]]. Depending on your needs, you should be able to keep your data locked to your own machine (this can be done with the [[Install/Desktop]] edition), or your [[Self Hosted]] server with [[Zero Tracking]], and not be forced to trust some third party.

If that all sounds simply _too perfect_... welcome to your new world.

_You were told there’s [no such thing as a silver bullet](https://en.wikipedia.org/wiki/No_Silver_Bullet); you were told wrong._

# The Fundamentals
SilverBullet combines a clean [[Live Preview]] markdown editor (that you’re looking at right now) with wiki-style linking, a robust database with query language, and a fully integrated [[Space Lua|Lua]] scripting environment.

SilverBullet keeps your content as a [[Revisions|versioned]] set of files on disk. Primarily as [[Markdown]] [[Page|Pages]] (as part of a [[Space]]). You navigate your space using the [[Page Picker]] or [[File Tree]], or through [[Link|Links]] like a wiki (except they are [[Linked Mention|bi-directional]]).

A [[Space]] may be yours alone, or shared with your team — see [[Guide/Working Together]].

Since SilverBullet is built as a [[PWA]] it can be accessed from any device with a browser (desktop, tablet or phone alike) and is [[ADR/001 Offline-First PWA|100% offline]] capable. No Internet connection? No problem. Keep editing and content will sync once you get back online.

If you are the **writer** type, you’ll appreciate SilverBullet as simply a clean [[Markdown]] editor with [[Live Preview]], accessible from any device. If you have more of an **outliner** personality, SilverBullet has [[Outlines|Outlining]] tools for you. Productivity freak? Have a look at [[Task|Tasks]]. More of a **database** person? You will appreciate [[Object|Objects]] and [[Space Lua/Integrated Query|Queries]] (SLIQ).

And if you are comfortable **programming** a little bit — now we’re talking. You will love _dynamically generating content_ with [[Space Lua]] (SilverBullet’s [[Lua]] dialect), or to use it to create custom [[Command|Commands]], [[Page Template|Page Templates]] or [[API/widget|Widgets]].

# Programmable notes
Dynamically generating content, _programmable notes_... why would you want that, and how does it work?

Hypothetical scenario: you have documented a set of product features in individual pages that you’ve [[Tag|tagged]] with a #feature tag, and annotated with a few custom [[Frontmatter]] [[Attribute|Attributes]].

With a simple [[Space Lua/Integrated Query|Query]] and [[Template]], you can now dynamically build a product feature list, ordered by _awesomeness_ (`Alt-click` or hover and click the edit button below to see the underlying code):
${query[[
  from f = index.pages("feature")
  order by f.awesomeness desc
  select templates.featureItem(f)
]]}
_(The template generating the feature bullet items can be found in [[^Library/Website Templates]])_

A few more use cases:

## Active pages
Let’s say you want to have a list of your 5 modified pages. We can do that:
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 5
  select templates.pageItem(p)
]]}

## To do items
Maybe you want to collect all [[Task|Tasks]] that you have not yet completed from across your space? No problem:
${query[[
  from t = tags.task
  where not t.done
  limit 3
  select templates.taskItem(t)
]]}

# Tour
That all sounds nice, but what does that look like in practice? Well, if you’re wondering purely about _looks_: have a look around — this very website is hosted as a _read-only_ SilverBullet instance. You probably already figured this out.

If you’d like a bit of a tour and demo, give this a watch:
${embed.youtube "https://www.youtube.com/watch?v=mik1EbTshX4"}
Want to see even more? Here is a whole [playlist with instruction videos](https://www.youtube.com/watch?v=bb1USz_cEBY&list=PLxFAb_vXRcEp4465MVI6Ha9wzNiX5VevQ) that go more in depth.

Convinced? Proceed to [[Install]], then follow [[Getting Started]] to learn the basics.

Want to go beyond? Join our [Community Forums](https://community.silverbullet.md/) and be sure to subscribe to the [No SilverBullet](https://no.silverbullet.plus/) newsletter and blog.

Have fun!