---
description: Reference-style and inline footnotes.
---

SilverBullet supports footnotes in two flavors: classic **reference-style** footnotes and **inline** footnotes. Both are rendered as a small widget in [[Live Preview]] and show their content on hover.

# Reference-style footnotes
A reference uses `[^label]` and is paired with a definition `[^label]: body` somewhere in the same page. Labels can be any string without whitespace or `]`.

Here is some text with a footnote.[^example] And a longer one.[^longer]

[^example]: This is the footnote body.
[^longer]: A footnote body can span multiple lines, as long as
    continuation lines are indented by at least four spaces (or one tab).

    Blank lines are allowed between continuation paragraphs, and **markdown**
    inside the body is parsed and rendered.

The definition can appear anywhere in the page (top, bottom, or interleaved). It is conventional to put them at the bottom.

# Inline footnotes
Inline footnotes use `^[content]` and place the body right at the call site:

This claim has an inline footnote.^[Inline footnotes don't need a separate definition.]

The content is parsed as inline markdown.

# Editor behavior
* In [[Live Preview]], a footnote reference renders as a compact `…` widget. Move the cursor into it to see and edit the raw `[^label]` source.
* Hover over a reference to see the rendered footnote body in a tooltip. For an undefined reference, the tooltip shows an error.
* **Click** a reference to jump to its definition. **Alt-click** moves the cursor into the marker for editing instead.
* Unresolved references (no matching definition) are styled distinctly so you can spot them.
* Typing `[^` triggers completion suggesting all footnote labels already defined on the page.
