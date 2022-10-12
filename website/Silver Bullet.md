## Markdown as a platform

Silver Bullet (SB) is highly-extensible,
[open source](https://github.com/silverbulletmd/silverbullet) **personal
knowledge management** software. Indeed, that’s fancy language for “a note
taking app with links.”

Here is a screenshot:

![Silver Bullet PWA screenshot](silverbullet-pwa.png)

At its core, SB is a Markdown editor that stores _pages_ (notes) as plain
markdown files in a folder referred to as a _space_. Pages can be cross-linked
using the `[[link to other page]]` syntax. However, once you leverage its
various extensions (called _plugs_) it can feel more like a _knowledge
platform_, allowing you to annotate, combine and query your accumulated
knowledge in creative ways, specific to you. To get a good feel for it,
[watch this video](https://youtu.be/RYdc3UF9gok).

Or [try it in a sandbox demo environment](https://demo.silverbullet.md/Sandbox).

## Extensions

What type of extensions, you ask? Let us demonstrate this in a very meta way: by
querying a list of plugs and injecting it into this page!

Here’s a list of (non-built-in) plugs documented in this space (note the
`#query` ... `/query` notation used):

<!-- #query page where type = "plug" order by name render [[template/plug]] -->

- [[🔌 Backlinks]] by **Guillermo Vayá**
  ([repo](https://github.com/Willyfrog/silverbullet-backlinks))
- [[🔌 Core]] by **Silver Bullet Authors**
  ([repo](https://github.com/silverbulletmd/silverbullet))
- [[🔌 Ghost]] by **Zef Hemel**
  ([repo](https://github.com/silverbulletmd/silverbullet-ghost))
- [[🔌 Git]] by **Zef Hemel**
  ([repo](https://github.com/silverbulletmd/silverbullet-github))
- [[🔌 Github]] by **Zef Hemel**
  ([repo](https://github.com/silverbulletmd/silverbullet-github))
- [[🔌 Mattermost]] by **Zef Hemel**
  ([repo](https://github.com/silverbulletmd/silverbullet-mattermost))
- [[🔌 Mount]] by **Zef Hemel**
  ([repo](https://github.com/silverbulletmd/silverbullet-mount))
- [[🔌 Query]] by **Silver Bullet Authors**
  ([repo](https://github.com/silverbulletmd/silverbullet))

<!-- /query -->

In a regular SB installation, the body of this query 👆 (in between the
placeholders) would automatically be kept up to date as new pages are added to
the space that match the query. 🤯 Have a look at the [[template/plug]]
_template_ (referenced in the `render` clause) to see how the results are
rendered using handlebars syntax and have a look at one of the linked pages to
see how the _metadata_ is specified, which is subsequently used to query and
render in this page. And to learn about the specific plug, of course.

## Explore more

Click on the links below to explore various aspects of Silver Bullet more
in-depth:

- [[CHANGELOG]]
- [[🤯 Features]]
- [[💡 Inspiration]]
- [[🔌 Plugs]]
- [[🔨 Development]]

More of a video person? Here are two to get you started:

- [A Tour of Silver Bullet’s features](https://youtu.be/RYdc3UF9gok) — spoiler
  alert: it’s cool.
- [A look the SilverBullet architecture](https://youtu.be/mXCGau05p5o) — spoiler
  alert: it’s plugs all the way down.

## Principles

Some core principles that underly Silver Bullet’s philosophy:

- **Free and open source**. Silver Bullet is MIT licensed.
- **The truth is in the markdown.** Markdown is simply text files, stored on
  disk. Nothing fancy. No proprietary formats or lock in. While SB uses a
  database for indexing and caching some data, all of that can be rebuilt from
  its markdown source at any time. If SB would ever go away, you can still read
  your pages with any text editor.
- **Single, distraction-free mode.** SB doesn’t have a separate view and edit
  mode. It doesn’t have a “focus mode.” You’re always in focused edit mode, why
  wouldn’t you?
- **Keyboard oriented**. You can use SB fully using the keyboard, typin’ the
  keys.
- **Extend it your way**. SB is highly extensible with [[🔌 Plugs]], and you can
  customize it to your liking and your workflows.

## Installing Silver Bullet

Silver Bullet is built using [Deno](https://deno.land). To install it, you will
need to have Deno installed (tested on 1.26 or later). If you have homebrew on a
Mac, this is just a single `brew install deno` away.

To run Silver Bullet create a folder for your pages (it can be empty, or be an
existing folder with `.md` files) and run the following command in your
terminal:

    deno run -A --unstable https://get.silverbullet.md <pages-path>

However, because this command is not super easy to remember, you may install it
as well:

    deno install -f --name silverbullet -A --unstable https://get.silverbullet.md

This will create a `silverbullet` (feel free to replace `silverbullet` in this
command with whatever you like) alias in your `~/.deno/bin` folder. Make sure
this path is in your `PATH` environment variable.

This allows you to install Silver Bullet simply as follows:

    silverbullet <pages-path>

By default, SB will bind to port `3000`, to use a different port use the
`--port` flag. By default SB doesn’t offer any sort of authentication, to add
basic password authentication, pass the `--password` flag.

Once downloaded and booted, SB will print out a URL to open SB in your browser
(spoiler alert: by default this will be http://localhost:3000 ).

That’s it! Enjoy.

If you (hypothetically) find bugs or have feature requests, post them in
[our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want
to contribute?
[Check out the code](https://github.com/silverbulletmd/silverbullet).
