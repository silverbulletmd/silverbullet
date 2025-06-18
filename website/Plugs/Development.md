> **warning** Unstable APIs
> The plug APIs are still unstable and tend to change. You’re welcome to experiment and build stuff, but do take into account that things tend to change. Also note that all this is horrifically under documented.

The easiest way to get started is to click the “Use this template” on the [silverbullet-plug-template](https://github.com/silverbulletmd/silverbullet-plug-template) repo.

Generally, every plug consists of a YAML manifest file named `yourplugname.plug.yaml`. This file defines all functions that form your plug. To be loadable by SilverBullet, it needs to be compiled into a bundle (ending with `.plug.js`).

For this you need to have [Deno](https://deno.com) installed, after which you can run the `deno task build` command specified in the plug template repo:

```shell
deno task build
```

For development it’s easiest to simply copy the `.plug.js` file into your space’s `_plug/` folder after it’s built:

```shell
cp myplug.plug.js ~/myspace/_plug/
```

Within seconds (watch your browser’s JavaScript console), your plug should be picked up both on the server and, synced to your browser and loaded. No need to even reload the page.

## Debugging
Since plugs run in your browser, you can use the usual browser debugging tools. When you `console.log` things, these logs will appear in your browser’s JavaScript console.

## Distribution
Once you’re happy with your plug, you can distribute it in various ways:

- You can put it on github by simply committing the resulting `.plug.js` file there and instructing users to point to by adding
  `- github:yourgithubuser/yourrepo/yourplugname.plug.js` to their `PLUGS` file
- Add a release in your github repo and instruct users to add the release as `- ghr:yourgithubuser/yourrepo` or if they need a specific release `- ghr:yourgithubuser/yourrepo/release-name`
  - You need to upload the plug file as asset in the release, with a name matching your repository, e.g, `yourrepo.plug.js`
  - If your repository name starts with "silverbullet-", like `silverbullet-foo`, both `silverbullet-foo.plug.js` and `foo.plug.js` asset names will be tried
- You can put it on any other web server, and tell people to load it via https, e.g., `- https://mydomain.com/mypugname.plug.js`.
