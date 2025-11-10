To develop your own SilverBullet library follow the following steps:

# Write the code
Put all functionality you like in a [[Meta Pages|Meta Page]] somewhere under `Library/`, e.g. `Library/My Library`.

These can, for instance, contain:
* [[Space Lua]]
* [[Space Style]]

However, you can also include
* [[Page Templates]]
* [[Slash Commands]]

# Frontmatter
Decorate your library page with some [[Frontmatter]], at the very least:
```
---
tags: meta/library
---
```
If you want to distribute additional pages or files with the library (such as `.plug.js` files, or additional pages like page templates and slash commands) make sure that they are kept at the same folder level as your library page. For instance if your library page is `Library/My Library` you can create an additional `Library/Page Template` or have a `Library/myplug.plug.js` and then mark them for distribution by adding them to the `files` key in your frontmatter, e.g.
```
---
tags: meta/library
files:
- Page Template.md
- myplug.plug.js
---
```

# Share the library
At this stage you can put your library file anywhere you like with a URL. However, it’s easiest to leverage [[Share]] support for publishing.

For the purposes of this example, let’s use Github. Create a [[^Library/Std/Infrastructure/Github]] token and configure it as specified in the [[^Library/Std/Infrastructure/Github#Configuration|instructions]].

[[^Library/Std/Infrastructure/Github]] share support offers two options: gists and Github repo files. Let’s use a Github repo.

[Create a new github repo](https://github.com/new), you can name it something like `silverbullet-libraries`.

In your library to be shared, run the ${widgets.commandButton "Share: Page"} command, then select “Github file”. This will ask for a few things:
1. The repo name: enter your `user/repo` here
2. The branch name: you can keep this as `main`
3. The file name: while this defaults to using a `Library/` prefix, remove that and just name it e.g. `My Library.md`
4. A commit message: pick whatever you like

If all went well, an initial version of your page should now be uploaded to github, check your repo page. You’ll notice that a few [[Share]] related frontmatter keys were set in your local copy (but not in the remote version). You can now make further changes to your page and run the `Share: Page` command again (Cmd-p or Ctrl-p by default) and after entering another commit message your page will be pushed again. This is how you publish new version for other people to use.

If your library consisted of multiple files, do the same for the other files. If you rely on plugs, unfortunately you have to push those in some other way.

Your library is now ready to install, you can test this by running ${widgets.commandButton "Library: Install"}. As URI you can either install the full Github URL of the markdown file, or use the value of what is generated under `share.uri` in your library’s frontmatter. Give it a temporary name, to test it all works. Then delete the page again.

You can now [broadcast that your library is ready to install](https://community.silverbullet.md/c/plugs-libraries/14)!

# Create a repository
If you develop a few libraries and keep adding more, it may be good to make them a bit more discoverable. To do so, you can group them in a [[Repositories|Repository]] (not to be confused with a Github repository).

For this, create another page, this time under `Repository/`, e.g. `Repository/<<yourname>>`. In it, put a list of all your awesome libraries, encoded in a [[Objects#data|data object]] as follows.

~~~
```#meta/library/remote
name: yourname/Library1
uri: github:username/silverbullet-libraries/Library1.md
---
name: yourname/Library2
uri: github:username/silverbullet-libraries/Library2.md
```
~~~

Note that it’s a good idea to namespace your libraries a bit, hence the `yourname/` prefix in _name_.

Now share this repo page using [[Share]] to the same github repo (or any other, it doesn’t really matter), and call it `REPO.md` (by convention).

Then announce to the [community](https://community.silverbullet.md/c/plugs-libraries/14) that your repo is open for business and they can add it via the ${widgets.commandButton "Library: Add Repository"} command (either based on the full Github URL, or the `share.uri` set in your frontmatter).
