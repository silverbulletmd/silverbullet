SilverBullet is a [[Malleable]], [[Private]], [[Open Source]], [[Self Hosted]], [[Knowledge Management System]].

_Yowza!_ That surely is a lot of adjectives to describe, effectively, a browser-based [[Markdown]] editor programmable with [[Lua]].

Let’s get more specific.

SilverBullet combines a clean [[Live Preview]] markdown editor (that you’re looking at right now) with wiki-style linking, a database with query language, and a fully integrated [[Space Lua|Lua]] scripting environment — turning your notes into a live, programmable system that grows with you, or your team.

SilverBullet keeps your content as a [[Revisions|versioned]] set of files on disk. Primarily as [[Markdown]] [[Page|Pages]] (called a [[Space]]). You navigate your space using the [[Page Picker]] or [[File Tree]] like a traditional notes app, or through [[Link|Links]] like a wiki (except they are [[Linked Mention|bi-directional]]).

A space may be yours alone, or shared with your team — see [[Guide/Working Together]].

If you are the **writer** type, you’ll appreciate SilverBullet as a clean [[Markdown]] editor with [[Live Preview]]. If you have more of an **outliner** personality, SilverBullet has [[Outlines|Outlining]] tools for you. Productivity freak? Have a look at [[Task|Tasks]]. More of a **database** person? You will appreciate [[Object|Objects]] and [[Space Lua/Integrated Query|Queries]] (SLIQ).

And if you are comfortable **programming** a little bit — now we’re really talking. You will love _dynamically generating content_ with [[Space Lua]] (SilverBullet’s [[Lua]] dialect), or to use it to create custom [[Command|Commands]], [[Page Template|Page Templates]] or [[API/widget|Widgets]].

You were told there’s no such thing as a silver bullet. You were told wrong.

# Programmable notes
Dynamically generating content, _programmable notes_... why would you want that, and how does it work?

Let’s say you have documented a set of product features in individual pages that you’ve [[Tag|tagged]] with a #feature tag, and annotated with a few custom [[Frontmatter]] [[Attribute|Attributes]].

With a simple [[Space Lua/Integrated Query|Query]] and [[Template]], you can now dynamically build a product feature list, ordered by _awesomeness_ (`Alt-click` or hover and click the edit button to see the underlying code):
${query[[
  from f = tags.feature
  where f.tag == "page"
  order by f.awesomeness desc
  select templates.featureItem(f)
]]}
_(The template generating the feature bullet items can be found in [[^Library/Website Templates]])_

Neat huh? A few more use cases.

## Active pages
Let’s say you want to have a list of your 5 modified pages. We can do that:
${query[[
  from p = tags.page
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

# [[Install]]
As mentioned, SilverBullet is a [[Self Hosted]] web application. This is great if you care about [[Data Sovereignty]], but it does mean you need to [[Install]] it on a server yourself. Perhaps you do this on a Raspberry Pi you didn’t have a use for, a VPS somewhere in the cloud, or a box your team already runs. SilverBullet is distributed as a single self-contained server [[Install/Server Binary]] or [[Install/Docker]] container.

Want a **pure desktop app experience**? Give [SilverBullet+](https://silverbullet.plus) a try.

While this is a bit more complicated to set up than simply downloading desktop app or signing up for an account with some online service, self hosting is a path to both [[Data Sovereignty]] and to access your content from any device with a modern browser.

Ready? Proceed to [[Install]], then follow [[Getting Started]] to learn the basics.

Enjoy!