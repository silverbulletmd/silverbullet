You can publish a space as a read-only website by running SilverBullet Server in read-only mode; this documentation site is published that way.

# Read-only mode
Set the `SB_READ_ONLY` environment variable to a non-empty value (see [[Install/Configuration]]). Visitors get the full SilverBullet client, including navigation, [[Linked Mention|linked mentions]] and live [[Space Lua/Integrated Query|queries]], but all edit functionality and commands are disabled. On start the server indexes the whole space, after which all writes are refused.

Set `SB_INDEX_PAGE` to choose the page visitors land on (see [[Index Page]]).

# Example: this site
The image behind this site is built from `Dockerfile.website` in the [SilverBullet repository](https://github.com/silverbulletmd/silverbullet): it starts from the SilverBullet Server image, copies the `docs` folder in as the space, sets `SB_READ_ONLY=1` and `SB_INDEX_PAGE=SilverBullet`, and adds the Silversearch plug for [[Full Text Search]]. Its navigation and section pages are plain [[Space Lua]] in [[^Library/Website]].

# Styling
A published space is styled like any other: use [[Space Style]] for CSS and [[Page Decorations]] for icons and prefixes.
