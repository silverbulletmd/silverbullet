Plug management using the `PLUGS` file is also implemented in the [[Plugs/Editor]] plug.

The optional `PLUGS` file is only processed when running the {[Plugs: Update]} command, in which case it will fetch all the listed plugs and copy them into the (hidden) `_plug/` folder in the user’s space. SilverBullet loads these files on boot (or on demand after running the {[Plugs: Update]} command).

You can also use the {[Plugs: Add]} to add a plug, which will automatically create a `PLUGS` if it does not yet exist.

The [[Plugs/Editor]] plug has support for the following URI prefixes for plugs:

* `https:` loading plugs via HTTPS, e.g. `[https://](https://raw.githubusercontent.com/silverbulletmd/silverbullet-github/main/github.plug.js)`
* `github:org/repo/file.plug.js` internally rewritten to a `https` url as above.
* `ghr:org/repo/version` to fetch a plug from a Github release. Will fetch latest version, if it was omitted.
