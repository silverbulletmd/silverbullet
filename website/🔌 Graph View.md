---
type: plug
uri: github:silverbulletmd/silverbullet-graphview/graphview.plug.json
repo: https://github.com/silverbulletmd/silverbullet-graphview
author: Bertjan Broeksema
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-graphview/main/README.md]] -->
# SilverBullet plug for showing a graph view of the documents

This plug aims to bring similar functionality as the Obsidian Graph view to
Silver Bullet.

This repo is a fork of
[Bertjan Broeksema's original repo](https://github.com/bbroeksema/silverbullet-graphview)

## Installation

Open (`cmd+k`) your `PLUGS` note in SilverBullet and add this plug to the list:

```yaml
- github:silverbulletmd/silverbullet-graphview/graphview.plug.js
```

Then run the `Plugs: Update` command and off you go!

## Usage

Run the `Show Global Graph` command to open up the graph view. Zoom and pan is
supported by scroll and pinch gestures with the mouse(pad).

### Tags & Paths

Set tags on the pages to customize their appearance in the graph

- `#node_color=ff0000` → Change node color to red
- `#.graphignore` → Hide the page from the graph

You can also use other custom tags to define node colors: Create a colormap with
HEX-colorcodes in `SETTINGS.md`. In this example, a node of a page where the tag
`#garden` is set will be rendered as green:

```yaml
# Graphview
graphview:
  default_color: "000000"
  colormap:
    path:
      ⚙ services: "01017a"
      📓 notes: "02bdb6"
      🚧 projects: "ffc533"
      🧰 how-to: "96020e"
    tag:
      garden: "0bbd02"
```

## Links

Click on the node labels to directly navigate to pages in your space

## Label-shortening

Long labels are shortened for readability. E.g.
`notesarecool/somethingverylong/subsubsubsub/foo` → `notes./somet./subsu./foo`

## For offline development

To ease development of the visual part, the offline folder contains a copy of
the html and custom javascript. As well as a simple graph model.

```bash
$ cd offline
$ python -m http.server
```
<!-- /include -->
