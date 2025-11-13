To develop your own SilverBullet library follow these steps:

# Write the code
Put all functionality you like in a [[Meta Pages|Meta Page]] somewhere under `Library/`. For namespacing purposes it’s good form to put your (Github) username in the path as well, so create, for instance `Library/myuser/My Library`.

A library can contain, for instance:
* [[Space Lua]]
* [[Space Style]]

However, you can also include
* [[Page Templates]]
* [[Slash Commands]]

# Frontmatter
Decorate your library page with some [[Frontmatter]], at the very least:
```
---
name: Library/myuser/My Library
tags: meta/library
---
```

> **note** Important
> The `name` key _has_ to match your page’s full (path) name. Otherwise a validation error will appear on the frontmatter. When another user installs your library, they will install it to the location specified here.

If you want to distribute additional pages or files with the library (such as `.plug.js` files) make sure that they are kept at the same folder level as your library page. For instance if your library page is `Library/myuser/My Library` you can have a `Library/myuser/myplug.plug.js` and then mark it for distribution by adding it to the `files` key in your frontmatter, e.g.
```
---
tags: meta/library
files:
- myplug.plug.js
---
```

# Share the library
At this stage you can put your library file anywhere you like with a URL. However, it’s easiest to leverage [[Share]] support for publishing.

For the purposes of this example, let’s use Github. Create a [[^Library/Std/Infrastructure/Github]] token and configure it as specified in the [[^Library/Std/Infrastructure/Github#Configuration|instructions]].

[[^Library/Std/Infrastructure/Github]] share support offers two options: Gists and Github repo files. Let’s use a Github repo.

[Create a new github repo](https://github.com/new), you can name it something like `silverbullet-libraries`.

In your library to be shared, run the ${widgets.commandButton "Share: Page"} command, then select “Github file”. This will ask for a few things:
1. The repo name: enter your `user/repo` here
2. The branch name: you can keep this as `main`
3. The file name: while this defaults to using your full page, remove that and just name it e.g. `My Library.md`
4. A commit message: pick whatever you like

If all went well, an initial version of your page should now be uploaded to github, check your repo page.

You’ll notice that a few [[Share]] related frontmatter keys were set in your local copy (but not in the remote version). You can now make further changes to your page and run the `Share: Page` command again (Cmd-p or Ctrl-p by default) and after entering another commit message your page will be pushed again. This is how you publish new version for other people to use.

If you used `files` to include additional assets, you have to commit those to the repository through other means.

Your library is now ready to install, you can test this by running ${widgets.commandButton "Library: Install"} in a fresh space. As URI you can either user the full Github URL of the markdown file, or use the value of what is generated under `share.uri` in your library’s frontmatter. 

You can now [broadcast that your library is ready to install](https://community.silverbullet.md/c/plugs-libraries/14)!

# Create a repository
If you develop a few libraries, it may be good to make them more discoverable. To do so, you can group them in a [[Repositories|Repository]] (not to be confused with a Github repository).

For this, create another page, this time under `Repository/`, e.g. `Repository/myuser` and tag it with `#meta/repository`. In the page body, put a list of all your libraries, encoded in a [[Objects#data|data object]] as follows.

~~~
```#meta/library/remote
name: myuser/Library1
description: This is my first awesome library
website: http://url.com/to/docs
uri: github:myuser/silverbullet-libraries/Library1.md
---
name: myuser/Library2
description: This is my second awesome library
uri: github:myuser/silverbullet-libraries/Library2.md
```
~~~

Required keys are:
* `name`: a descriptive name of your library (this may include your username to clearly distinguish it from other, similar libraries). **Note**: this name is _not_ used as an installation location, the installation location is determined by the `name` key in the library itself.
* `uri`: The URI to install the library from.

Now share this repo page using [[Share]] to the same github repo (or any other, it doesn’t really matter), and call it `REPO.md` (by convention).

Then announce to the [community](https://community.silverbullet.md/c/plugs-libraries/14) that your repo is open for business and they can add it via the ${widgets.commandButton "Library: Add Repository"} command (either based on the full Github URL, or the `share.uri` set in your frontmatter).
