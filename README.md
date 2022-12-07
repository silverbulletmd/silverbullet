# Silver Bullet

Silver Bullet (SB) is an extensible, open source **personal knowledge
platform**. At its core it’s a clean markdown-based writing/note taking
application that stores your _pages_ (notes) as plain markdown files in a folder
referred to as a _space_. Pages can be cross-linked using the
`[[link to other page]]` syntax. This makes it a simple tool for
[Personal Knowledge Management](https://en.wikipedia.org/wiki/Personal_knowledge_management).
However, once you leverage its various extensions (called _plugs_) it can feel
more like a _knowledge platform_, allowing you to annotate, combine and query
your accumulated knowledge in creative ways specific to you.

<img src="https://github.com/silverbulletmd/silverbullet/raw/main/website/silverbullet-pwa.png" height="400"/><img src="https://github.com/silverbulletmd/silverbullet/raw/main/website/silverbullet-ios.png" height="400"/>

For more in-depth information, an interactive demo, and links to more
background, check out the [Silver Bullet website](https://silverbullet.md)
(published from this repo’s `website/` folder).

Or checkout these two videos:

- [A Tour of some of Silver Bullet’s features](https://youtu.be/VemS-cqAD5k) —
  spoiler alert: it’s cool.
- [A look the SilverBullet architecture](https://youtu.be/mXCGau05p5o) — spoiler
  alert: it’s plugs all the way down.

## Features

- **Free and open source**. Silver Bullet is MIT licensed.
- **The truth is in the markdown.** Silver Bullet doesn’t use proprietary file
  formats. It keeps its data as plain markdown files on disk. While SB uses a
  database for indexing and caching some indexes, all of that can be rebuilt
  from its markdown source at any time. If SB would ever go away, you can still
  read your pages with any text editor.
- **One single, distraction free mode.** SB doesn’t have a separate view and
  edit mode. It doesn’t have a “focus mode.” You’re always in focused edit mode,
  why wouldn’t you?
- **Keyboard oriented**. You can use SB fully using the keyboard, typin’ the
  keys.
- **Extend it your way**. SB is highly extensible with
  [plugs](https://silverbullet.md/🔌_Plugs), and you can customize it to your
  liking and your workflows.

## Installing Silver Bullet with Deno

### Installing Deno

Silver Bullet is built using [Deno](https://deno.land). To install Deno on Linux
or Mac run:

```shell
curl -fsSL https://deno.land/install.sh | sh
```

This will install Deno into `~/.deno/bin`, add this folder to your `PATH` in
your `~/.bashrc` or `~/.zshrc` file.

To install Deno on Windows (using Powershell) run:

```powershell
irm https://deno.land/install.ps1 | iex
```

### Install Silver Bullet

With Deno installed (see instruction above), run:

```shell
deno install -f --name silverbullet -A --unstable https://get.silverbullet.md
```

This will install `silverbullet` into your `~/.deno/bin` folder (which should
already be in your path if you installed Deno following the previous
instructions).

To run Silver Bullet create a folder for your pages (it can be empty, or be an
existing folder with `.md` files) and run the following command in your
terminal:

```shell
silverbullet <pages-path>
```
By default, SB will bind to port `3000` on all interfaces. To specify a
different address or port to listen on, use the `--hostname` and `--port`
options. By default SB doesn’t add authentication, to add
basic password authentication (BasicAuth), pass the `--user` flag (e.g.
`--user pete:1234` for username `pete` and password `1234`).

Once downloaded and booted, SB will print out a URL to open SB in your browser
(spoiler alert: by default this will be http://localhost:3000 ).

#protip: If you have a PWA enabled browser (like any browser based on Chromium)
hit that little button right of the location bar to install SB, and give it its
own window frame (sans location bar) and desktop/dock icon. At last the PWA has
found its killer app.

## Upgrading Silver Bullet

Simply run this:

    silverbullet upgrade

And restart Silver Bullet. You should be good to go.

## Installing Silver Bullet with Docker

There is a docker image on docker hub. To use it, first create a volume to keep your space (markdown) files:

```shell
docker volume create myspace
```

Then, run the container, e.g. as follows:

```shell
docker run -p 3000:3000 -v myspace:/space -d --name silverbullet zefhemel/silverbullet
```

If you'd like to pass in additional command line arguments (e.g. `--user` to add authentication) you can just append those to the command, e.g.:

```shell
docker run -p 3000:3000 -v myspace:/space -d --name silverbullet zefhemel/silverbullet --user me:letmein
```

To build your own version of the docker image, run `./scripts/build_docker.sh`.

You can also use docker-compose if you prefer. From a silverbullet check-out run:

```shell
deno task bundle
PORT=3000 docker-compose up
```

or similar.

## Troubleshooting

If you upgraded to the new Deno-based Silver Bullet from an old version, you may
have to use the `silverbullet fix <pages-path>` command to flush out your old
database and plugs. Plugs will likely need to be updated.

## Developing Silver Bullet

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/silverbulletmd/silverbullet)

Silver Bullet is written in [TypeScript](https://www.typescriptlang.org/) and
built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor
component. Additional UI is built using React.js.
[ParcelJS](https://parceljs.org/) is used to build both the front-end and
back-end bundles. The server backend runs as a HTTP server on node.js using
express.

To prepare the initial web and plug build run:

```shell
deno task build
```

To symlink `silverbullet` to your locally checked-out version, run:

```shell
deno task install
```

You can then run the server in “watch mode” (automatically restarting when you
change source files) with:

```shell
deno task watch-server <PATH-TO-YOUR-SPACE>
```

After this initial build, it's convenient to run three commands in parallel (in
separate terminals):

```shell
deno task watch-web
deno task watch-server <PATH-TO-YOUR-SPACE>
deno task watch-plugs
```

## Feedback

If you (hypothetically) find bugs or have feature requests, post them in
[our issue tracker](https://github.com/silverbulletmd/silverbullet/issues).
Would you like to contribute?
[Check out the code](https://github.com/silverbulletmd/silverbullet), and the
issue tracker as well for ideas on what to work on.
