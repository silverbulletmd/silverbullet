SilverBullet can run in two modes:

1. Single-Space mode (legacy)
2. Multi-Space mode (default)

If you installed SilverBullet fresh anywhere since 2.10 — you’re in multi-space mode. Don’t worry about any of this, we’re good.

# Single-space mode
If you installed a version of SilverBullet that’s older than 2.10, you will have installed it in what is now called “single-space mode”. A mode in which SilverBullet only serves a single space. In addition, it has more restrictions:

1. No support for multiple accounts (just a single one configured via the `SB_USER` environment variable)
2. No support for per-space permissions (everything is write accessible the the configured single user)
3. Limited support for [[Revisions]], specifically [[Revisions#Syncing with a remote]].
4. No support for [[Single Sign-On]] (obviously)
5. Limited support for [[At-Mention]]
6. Likely many future updates will not be configurable in this environment.

Anyway, the short version of it is: migrate to multi-space when you can.

# Multi-space mode
This is the promised land:

1. You can create **multiple spaces** on a single server (hence the name).
2. You can create **multiple accounts** and even authenticate them with [[Single Sign-On]] if you like.
3. You have the ability to set (basic) permissions per user, per space
4. You have [[Revisions]] with git sync, if you like
5. [[At-Mention]] auto complete for user accounts

Of course, you can still decide to just configure a single space and a single user. That’s fine, but it gives you options down the line.

Use multi-space mode.

# Migrating from single-space to multi-space
1. Spin up a fresh SilverBullet instance next to your existing one, pointing your data folder at a fresh folder.
2. Run through the setup flow via the web UI and set up a fresh new space, noting where the space will be stored physically (e.g. `spaces/notes`).
3. Move (or to be safer: copy) all your space files from your old SB instance into this `spaces/notes` (or whatever) folder mounted into the new container.
4. Open the space via the new instance to make sure everything is there.
5. Profit.