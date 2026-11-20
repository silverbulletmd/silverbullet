---
references:
- bin/silverbullet/src/publish.rs
- bin/silverbullet/src/server.rs
- Dockerfile.publish
- Dockerfile.website
---
SilverBullet Server can publish your space as a website in two ways:

* `silverbullet publish` serves a folder as a public, read-only website. Use this for documentation and other sites you update by changing files.
* On a server with the [[Dashboard]], you give the public read access to a **whole space**. Visitors browse it without an account while you and your team keep editing the same space.

Either way, visitors get the full SilverBullet client, including navigation, [[Linked Mention|linked mentions]] and live [[Space Lua/Integrated Query|queries]], but can’t edit anything.

# Publish a folder as a website
Point `silverbullet publish` at a folder of Markdown files:

```bash
silverbullet publish ./docs
```

The folder is the argument, or else `SB_FOLDER`, or else the current directory. Unlike a normal server, it listens on all interfaces (`0.0.0.0`) on port 3000, because a published site is meant to be reached by others. Use `-L` and `-p` (or `SB_HOSTNAME` and `SB_PORT`) to change that, for example `-L 127.0.0.1` to keep it on this machine; see [[Administration/Server/Server Binary]]. The folder goes after `publish`: `silverbullet publish ./docs`, not `silverbullet ./docs publish`.

Changes to the files show up on the site without a restart. Files and folders whose names start with a `.` are never served.

## With Docker
The `publish` image runs `silverbullet publish` on whatever is in `/site`. To bake your pages into an image, put a `Dockerfile` next to the folder:

```dockerfile
FROM ghcr.io/silverbulletmd/silverbullet:publish
COPY docs /site
ENV SB_NAME="My Docs" SB_INDEX_PAGE=index
```

Or mount the folder instead of baking it in:

```bash
docker run -v ./docs:/site:ro -p 3000:3000 ghcr.io/silverbulletmd/silverbullet:publish
```

The container runs as user and group `65534` (`nobody`), so the files must be readable by that user. World-readable files, which is what most tools create, already are. Because nothing is written, the container also runs with `docker run --read-only`, without a writable `/tmp`.

The image is tagged `publish` (the same as `latest-publish`), `<version>-publish` (such as `2.12.1-publish`) and `edge-publish`. See [[Administration/Server/Docker]].

Until the next release, use `:edge-publish`: `:publish` and `:latest-publish` only exist once a release includes the publish image.

## Settings
Set these as environment variables:

| Variable | What it sets | Default |
|---|---|---|
| `SB_NAME` | The site’s name | `SilverBullet` |
| `SB_INDEX_PAGE` | The page visitors land on, see [[Index Page]] | `index` |
| `SB_DESCRIPTION` | The description search engines and link previews show | `Powerful and programmable note taking app` |
| `SB_THEME_COLOR` | The browser’s theme color | `#fcfcfd` |
| `SB_HEAD_HTML` | HTML added to the `<head>` of every page | none |
| `SB_SPACE_IGNORE` | Files to leave out of the site’s file list, as gitignore-style patterns | none |
| `SB_URL_PREFIX` | A path to serve the site under, such as `/docs` (`docs/` works too) | `/` |

`SB_HOSTNAME`, `SB_PORT` and `SB_UNIX_SOCKET` work as on any server, see [[Administration/Server/Configuration#Network]].

## What is fixed
A published site is always public and read-only. These can’t be changed:

* There are no accounts and no sign-in. The login page at `/.auth` says the site is published read-only.
* There is no [[Dashboard]], [[Integrations/MCP]] endpoint, [[Integrations/Runtime API]], shell, page history ([[Revisions]]) or [[Git]] sync.
* The site never shows where the folder is on the host. Clients see `published` as its path.

## Search
Visitors can use [[Features/Search]] with the **All words** and **Exact phrase** modes. The index is built in memory when the server starts, and kept current as files change. Semantic search isn’t available.

# Styling
A published space is styled like any other: use [[Reference/Theming/Space Style]] for CSS and [[Reference/Theming/Page Decorations]] for icons and prefixes.

# Let your team edit while the public reads
Second option: on a server with the [[Dashboard]], a space can be public while its members keep editing it.

## Make a space public
In the [[Dashboard]], open the space’s **Space settings → Access**. Under **Who has access**, set **Public (not signed in)** to **Read**. Anyone can now read the space without signing in. Page history and [[Revisions]] stay members-only.

Visitors can’t reach capability endpoints such as the shell or the [[Integrations/Runtime API]]. Members with `write` access keep editing as usual, and visitors see changes as soon as they’re saved. See [[Dashboard#Access]] for how public access combines with member roles.

Under **Space settings → General**, set **Index page** to choose the page visitors land on (see [[Index Page]]).

## Freeze a space
To make a published space read-only for everyone, including members and admins, check **Freeze this space** under **Space settings → Access**. Member permissions are kept for when you unfreeze it.

# Example: this site
This documentation is published with the `publish` image, built from `Dockerfile.website` in the [SilverBullet repository](https://github.com/silverbulletmd/silverbullet):

```dockerfile
ARG BASE_IMAGE=ghcr.io/silverbulletmd/silverbullet:edge-publish
FROM ${BASE_IMAGE}
COPY docs /site
ENV SB_NAME=SilverBullet SB_INDEX_PAGE=SilverBullet SB_DESCRIPTION="Powerful and programmable note taking app" SB_THEME_COLOR=#e1e1e1
```

Visitors can use the built-in [[Features/Search]], and its navigation and section pages are plain [[Reference/Space Lua]] in [[^Library/Website]].
