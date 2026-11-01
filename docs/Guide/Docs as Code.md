---
tags: guide
---
Keep documentation as Markdown in the same Git repository as the code it describes. Edit the files in SilverBullet, review them with the code change, and optionally publish a read-only documentation space.

This guide assumes you already use Git and pull requests. The example is Moonshot, a fictional photo-management application, with documentation in a `docs/` folder. You need a local checkout and [[Install/Desktop|SilverBullet Desktop]].

# Open the documentation folder
In Desktop’s dashboard, choose **New space** and select your checkout’s `docs/` folder. Existing Markdown files become pages. Opening the folder does not require an external Server or automatic Git sync.

Use the [[Page Picker]] or [[File Tree]] to find a page. Edit an existing document, or create `Importing Photos` and write:

```markdown
# Import photos
Choose the folder containing your photos, then review the proposed import.

For supported formats, see [[Supported Formats]].
```

Create the linked page with the formats your application actually supports. [[Guide/Your First Markdown Page]] covers Markdown editing, and [[Guide/Find and Connect Pages]] covers links. The same fundamentals apply to documentation pages.

# Review documentation with the change
Use your usual Git tools to create a branch, inspect the Markdown diff, commit the documentation with the relevant code change and open a pull request. Each contributor edits their own checkout. SilverBullet notices external file changes, so changes pulled or checked out through Git appear in the space.

Keep repository history under your team’s normal Git workflow. Use **Unmanaged** [[Revisions#Modes|revisions]] for a repository you commit yourself: SilverBullet reads its history without creating commits. [[Revisions]] provides file history in SilverBullet, and managed spaces can use [[Guide/Git Sync|automatic Git sync]] for backup; that feature does not create branches or pull requests for you.

For example, when Moonshot adds an import format, update `Supported Formats` in the same pull request. The reviewer can assess the feature and its instructions together.

# Choose how readers will see the files
If readers use SilverBullet, page links, transclusions and live queries can remain interactive. You can use [[Guide/Build Your First Query|Workbench to build an overview]], and [[Customizing]] covers optional configuration and libraries.

If readers use a repository viewer or another publishing tool, check its support for SilverBullet’s Markdown extensions. [[Baked Sections]] can store dynamic output as Markdown. Baking does not by itself make every link or extension compatible with another renderer; preview the actual destination. [[Share#What gets published|Sharing transformations]] handle additional conversions when publishing through Share.

Keep essential instructions readable without running code. Show examples that modify files or configuration as copyable source, explain where to run them, and supply the input and expected result. They should not execute merely because somebody opens the documentation.

# Publish an approved version
Publishing is optional. To serve the docs in SilverBullet, deploy the approved documentation folder to a Server space and configure public read access as described in [[Publishing]]. Public access applies to the whole space, so keep internal documents out of that published folder. Set the index page to your documentation’s home page.

Preview as a public reader before publishing a release. Follow links, reveal and copy examples, inspect live results, and check screenshots at narrow widths. Read-only visitors cannot complete exercises that write data; direct them to their own writable space.

[[Guide/Publish a Collection]] covers publishing a selected set of pages to another destination. [Docs as code on silverbullet.md](https://silverbullet.md/docs-as-code) shows how SilverBullet’s own documentation uses this approach.
