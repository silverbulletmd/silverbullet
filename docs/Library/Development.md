---
description: "Build and publish a SilverBullet library."
tags: development
references:
- client/workbench/libraries/libraries_backend.ts
- client/workbench/libraries/library_requires.ts
- libraries/Library/Std/Infrastructure/Github.md
---
To develop your own SilverBullet library follow these steps:

# Decorate your library with frontmatter
Put all functionality you like in a [[Tool Page]] somewhere under `Library/`. Scripts and styles only run from there. For name spacing purposes it’s good form to put your (Github) username in the path as well, so create, for instance `Library/myuser/My Library`.

Then, decorate your library page with some [[Frontmatter]]. Here is an minimal example library that defines a new “Hello world” command:

    ---
    name: Library/myuser/My Library
    tags: meta/library
    ---
    This implements my super awesome hello world library!

    ```space-lua
    command.define {
      name = "Hello world",
      run = function()
        editor.flashNotification "Hello world!"
      end
    }
    ```

If your library calls `tag.define`, `config.set` or `config.define` in a `space-lua` block, add a `-- boot: true` comment line to that block so the call applies before indexing and first render. See [[Space Lua#Definition loading]].

> **note** Important
> The `name` key _has_ to match your page’s full (path) name. Otherwise a validation error will appear on the frontmatter. When another user installs your library, they will install it to the location specified here.

If you want to distribute additional pages or files with the library (such as `.plug.js` files) make sure that they are kept at the same folder level as your library page. For instance if your library page is `Library/myuser/My Library` you can have a `Library/myuser/myplug.plug.js` and then mark it for distribution by adding it to the `files` key in your frontmatter, e.g.:

```
---
name: Library/myuser/My Library
tags: meta/library
files:
- myplug.plug.js
---
```

# Require other libraries
When your library builds on another library, list it under `requires` rather than copying its pages or files into yours. Installing your library then installs it too, and it can’t be removed while your library is installed:

```
---
name: Library/myuser/Themes/Paper
tags: meta/library
requires:
- ../Fonts/Lora.md
- github:otheruser/silverbullet-libraries@main/Library/otheruser/Inter.md
---
```

Each entry is either a full URI (the one you would install that library from) or a path relative to your library’s own published URI, such as `../Fonts/Lora.md` (not starting with `/`). A relative path keeps the repository and branch your library was installed from, so a library installed from a release or a branch gets its requirements from the same place. Prefer relative paths for libraries in the same repository, and full URIs for anyone else’s. See [[Library#Libraries that require other libraries]] for how installing, updating and removing treat requirements.

# Share the library
At this stage you can put your library file anywhere you like with a URL. However, for convenience, it’s good to use [[Share]] support for publishing.

For the purposes of this example, let’s use Github. Create a [[^Library/Std/Infrastructure/Github]] token and configure it as specified in the [[^Library/Std/Infrastructure/Github#Configuration|instructions]].

[[^Library/Std/Infrastructure/Github]] share support offers two options: Gists and Github repo files. Let’s use a Github repo.

[Create a new github repo](https://github.com/new), you can name it something like `silverbullet-libraries`.

In your own writable space, open the library page and run the `Share: Page` command, then select “Github file”. This will ask for a few things:
1. The repo name: enter your `user/repo` here
2. The branch name: you can keep this as `main`
3. The file name: while this defaults to using your full page, remove that and just name it e.g. `My Library.md`
4. A commit message

If all went well, an initial version of your page should now be uploaded to github, check your repo page.

You’ll notice that a few [[Share]] related frontmatter keys were set in your local copy. You can now make further changes to your library and run the `Share: Page` command again. After entering another commit message your page will be pushed again. This is how you publish new versions of your library for other people to use.

If you used `files` to include additional assets, you have to commit those to the repository through other means.

Your library is now ready to install, you can test this by running `Library: Install` in a fresh space. As URI use the value of what is generated under `share.uri` in your library’s frontmatter.

You can now [broadcast that your library is ready to install](https://community.silverbullet.md/c/plugs-libraries/14)!

# Create a repository
If you develop a few libraries, it may be good to make them more discoverable. To do so, you can group them in a [[Repository|Repository]].

For this, create another page in your space, this time under `Library/Repository/`, e.g. `Library/Repository/myuser` and tag it with `#meta/repository`.

In the page body, put a list of all your libraries, encoded as [[Tag/data|data objects]] as follows:

    ---
    tags: meta/repository
    ---
    This is my curated list of awesome libraries!

    ```#meta/library/remote
    name: Library1
    description: This is my first awesome library
    website: http://url.com/to/docs
    uri: https://github.com/myuser/silverbullet-libraries/blob/main/Library1.md
    ---
    name: Library2
    description: This is my second awesome library
    uri: https://github.com/myuser/silverbullet-libraries/blob/main/Library2.md
    ```

Required keys are:
* `name`: a descriptive name of your library.
  **Note**: this name is _not_ used as an installation location, the installation location is determined by the `name` key in the library itself.
* `uri`: The URI to install the library from.

Additional recommended keys are:
* `description`: a more elaborate description of the library and its functionality
* `author`: who developed this library
* `website`: a website URL for more information
* `requires`: the library’s `requires` list, copied from its page, so the Library Manager can show what it requires before it is installed. Relative paths resolve against the entry’s `uri`. Installing always follows the library page’s own list.

Now share this repo page using [[Share]] to the same github repo (or any other, it doesn’t really matter), and call it `REPO.md` (by convention).

Then announce to the [community](https://community.silverbullet.md/c/plugs-libraries/14) that your repo is open for business and they can add it via the `Library: Add Repository` command (using the same `share.uri` set in your frontmatter).
