You can publish a space as a website by giving the public read access to it: visitors can browse it without an account, while you and your team keep editing the same space.

# Make a space public
In the [[Dashboard]], open the space’s **Space settings → Access**. Under **Who has access**, set **Public (not signed in)** to **Read**. Anyone can now read the space without signing in; page history and [[Revisions]] stay members-only.

Visitors get the full SilverBullet client, including navigation, [[Linked Mention|linked mentions]] and live [[Space Lua/Integrated Query|queries]], but can’t edit anything or reach capability endpoints such as the shell or the [[Runtime API]]. Members with `write` access keep editing as usual, and visitors see changes as soon as they’re saved. See [[Dashboard#Access]] for how public access combines with member roles.

Under **Space settings → General**, set **Index page** to choose the page visitors land on (see [[Index Page]]).

# Freeze a space
To make a published space read-only for everyone, including members and admins, check **Freeze this space** under **Space settings → Access**. Member permissions are kept for when you unfreeze it.

# Example: this site
This documentation is a SilverBullet space published for public reading, built from `Dockerfile.website` in the [SilverBullet repository](https://github.com/silverbulletmd/silverbullet). It adds the Silversearch plug for [[Full Text Search]], and its navigation and section pages are plain [[Space Lua]] in [[^Library/Website]].

# Styling
A published space is styled like any other: use [[Space Style]] for CSS and [[Page Decorations]] for icons and prefixes.
