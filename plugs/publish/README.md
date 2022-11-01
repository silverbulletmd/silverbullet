# Silver Bullet Publish
A simple tool to export a subset of your [SilverBullet](https://silverbullet.md) space as a static website.

**Note:** this is highly experimental and not necessarily production ready code, use at your own risk.

silverbullet-publish currentenly publishes a subset of a space in two formats:

* Markdown (.md files)
* HTML (.html files based on currently hardcoded templates (see `page.hbs` and `style.css`)

The tool can be run in two ways:

1. As a Silver Bullet plug (via the `Silver Bullet Publish: Publish All` command)
2. As a stand-alone CLI tool (via `npx`)

The latter allows for automatic deployments to e.g. environments like Netlify.

## Configuration
SilverBullet Publish is configured via the `PUBLISH` page with the following properties:

  ```yaml
  # Index page to use for public version
  indexPage: Public
  # Optional destination folder when used in plug mode
  destDir: /Users/you/my-website
  title: Name of the space
  removeHashtags: true
  removeUnpublishedLinks: false
  # Publish all pages with specific tag
  tags:
  - "#pub"
  # Publish all pages with a specifix prefix
  prefixes:
  - /public
  ```

## Running via `npx`
The easiest way to run SilverBullet Publish is via `npx`, it takes a few optional arguments beyond the path to your SilverBullet space:

* `-o` specifies where to write the output to (defaults to `./web`)
* `--index` runs a full space index (e.g. to index all hash tags) before publishing, this is primarily useful when run in a CI/CI pipeline (like Netlify) because there no `data.db` in your repo containing this index.

```bash
npx @silverbulletmd/publish -o web_build --index .
```