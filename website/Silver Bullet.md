## Markdown as a platform
Silver Bullet (SB) is highly-extensible, [open source](https://github.com/silverbulletmd/silverbullet) **personal
knowledge management** software. Indeed, that’s fancy language for “a note taking app with links.”

Here is a screenshot:

![Silver Bullet PWA screenshot](silverbullet-pwa.png)

At its core, SB is a Markdown editor that stores _pages_ (notes) as plain
markdown files in a folder referred to as a _space_. Pages can be cross-linked using the `[[link to other page]]` syntax. However, once you leverage its various extensions (called _plugs_) it can feel more like a _knowledge platform_, allowing you to annotate, combine and query your accumulated knowledge in creative ways, specific to you. To get a good feel for it, [watch this video](https://youtu.be/RYdc3UF9gok).

And then, [give it a try in our Sandbox](https://demo.silverbullet.md/Sandbox).

## Explore more
Click on the links below to explore various aspects of Silver Bullet more
in-depth:

* [[CHANGELOG]] — what’s new?
* [[🤯 Features]]
* [[💡 Inspiration]]
* [[🔌 Plugs]]
* [[🔨 Development]]

More of a video person? Here are two to get you started:

- [A Tour of Silver Bullet’s features](https://youtu.be/RYdc3UF9gok) — spoiler alert: it’s cool.
- [A look the SilverBullet architecture](https://youtu.be/mXCGau05p5o) — spoiler alert: it’s plugs all the way down.

## Principles
Some core principles that underly Silver Bullet’s philosophy:

- **Free and open source**. Silver Bullet is MIT licensed.
- **The truth is in the markdown.** Markdown is simply text files, stored on disk. Nothing fancy. No proprietary formats or lock in. While SB uses a database for indexing and caching some data, all of that can be rebuilt from its markdown source at any time. If SB would ever go away, you can still read your pages with any text editor.
- **Single, distraction-free mode.** SB doesn’t have a separate view and edit mode. It doesn’t have a “focus mode.” You’re always in focused edit mode, why wouldn’t you?
- **Keyboard oriented**. You can use SB fully using the keyboard, typin’ the keys.
- **Extend it your way**. SB is highly extensible with [[🔌 Plugs]], and you can customize it to your liking and your workflows.

## Installing Silver Bullet
This consists of two steps (unless Deno is already installed:

1. Installing Deno
2. Installing Silver Bullet itself

### Installing Deno
Silver Bullet is built using [Deno](https://deno.land). To install Deno on Linux or Mac run:

```shell
curl -fsSL https://deno.land/install.sh | sh
```

This will install Deno into `~/.deno/bin`, add this folder to your `PATH` in your `~/.bashrc` or `~/.zshrc` file.

To install Deno on Windows (using Powershell) run:

```powershell
irm https://deno.land/install.ps1 | iex
```

### Install Silver Bullet
With Deno installed, run:

```shell
deno install -f --name silverbullet -A --unstable https://get.silverbullet.md
```

This will install `silverbullet` into your `~/.deno/bin` folder (which should already be in your path if you installed Deno following the previous instructions).

To run Silver Bullet create a folder for your pages (it can be empty, or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
silverbullet <pages-path>
```

By default, SB will bind to port `3000`, to use a different port use the
`--port` flag. By default SB doesn’t offer any sort of authentication, to add basic password authentication, pass the `--password` flag.

Once downloaded and booted, SB will print out a URL to open SB in your browser (spoiler alert: by default this will be http://localhost:3000 ).

#protip: If you have a PWA enabled browser (like any browser based on Chromium) hit that little button right of the location bar to install SB, and give it its own window frame (sans location bar) and desktop/dock icon. At last the PWA has found its killer app.

## Upgrading Silver Bullet
Simply run this:

    silverbullet upgrade

And restart Silver Bullet. You should be good to go.

## Troubleshooting

If you upgraded to the new Deno-based Silver Bullet from an old version, you may have to use the `silverbullet fix <pages-path>` command to flush out your old database and plugs. Plugs will likely need to be updated.

If you (hypothetically) find bugs or have feature requests, post them in
[our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Want
to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet).
