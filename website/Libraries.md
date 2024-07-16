A lot of useful functionality in SilverBullet is implemented through [[Templates]], as well as regular [[Pages]]. Some of these you will create yourself for your own specific use, but many are generic and generally useful. Libraries offer a way to _distribute_ sets of templates and pages easily, but also help to give some guidance on how to structure templates for your personal use.

# What’s in a library
Here are some things that a library may provide:
* Various [[Slash Commands]], such as `/today`, `/task`, `/table`.
* Useful [[Page Templates]]
* Useful widgets such as [[Table of Contents]] or [[Linked Mentions]]
* Useful pages that help you perform maintenance on your space, like detecting broken links, such as [[Library/Core/Page/Maintenance]].

# Configuring libraries
Libraries are managed by specifying them in [[SETTINGS]] under the `libraries` attribute. The paths used to libraries are using [[Federation]] page reference syntax.

When you set up a fresh space, the [[Library/Core]] is automatically configured:

```yaml
libraries:
- import: "[[!silverbullet.md/Library/Core/*]]"
```

If you would like to _exclude_ specific pages, for instance [[Library/Core/Widget/Table of Contents]], you can do so using the library’s `exclude` attribute

```yaml
libraries:
- import: "[[!silverbullet.md/Library/Core/*]]"
  exclude:
  - "[[!silverbullet.md/Library/Core/Widget/Table of Contents]]"
```

In these paths, you can also use the `*` wildcard:

```yaml
  - "[[!silverbullet.md/Library/Core/Widget/*]]"
```

This would exclude all widgets specified in the Core library.

# Updating libraries
To update all libraries from their original source (we recommend doing this regularly to get the latest updates), run the {[Libraries: Update]} command.

Updating does the following for each library:

1. It _deletes_ all pages under its local source prefix in your space. For instance for the Core library, this would be `Library/Core/*`. This means that you should **not make local changes** to these files, because they will be wiped out on every update.
2. It downloads fresh copies from the `source` and puts them in the local source prefix (for `!silverbullet.md/Library/Core/*` this would be `Library/Core/`).
3. It performs a {[System: Reload]} so all new commands and configurations are immediately available.

# Where are libraries stored?
Libraries are kept in your space’s `Library/` folder. Since these are just regular [[Meta Pages]], the just live along the rest of your content. For instance, the [[Library/Core]] is kept under `Library/Core`. This is _largely_ a convention, but one worth to sticking to.

If you would like to keep your own templates as a library as well, we recommend putting them in `Library/Personal` as a convention. Then, when you identify a set that may be valuable to other people, you can move them elsewhere under `Library/`.

# Can I change libraries locally?
Technically there is nothing stopping you from making local changes to library content, however **these changes would be reset on every library update**.

Therefore, the recommended approach when requiring to make local adjustments is:
1. Make a copy (copy & paste or {[Page: Copy]}) of the page or template you want to change _outside_ the original library path, e.g. under `Library/Personal`.
2. _Exclude_ the page in question using the `exclude` attribute explained under [[#Configuring libraries]] and then run {[Libraries: Update]} again, to remove the excluded (non-modified) version of the page from your space.
3. Profit

# How to host a library?
This is a topic for exploration. The way it is done here at `silverbullet.md` is by running a SilverBullet instance with the libraries in read-only mode (see [[Install/Configuration#Run mode]]). However, we should explore easier ways to do this. Come talk to us in [the SilverBullet Community](https://community.silverbullet.md/) if you’re interested.

# What libraries exist?
Libraries are still a young concept in SilverBullet and therefore we’re still exploring how to organize and structure these.

Currently, we have the following libraries available:
* [[Library/Core]]: this is the library you want to use _for sure_. Just do it.
* [[Library/Journal]]: for the journalers among us.

