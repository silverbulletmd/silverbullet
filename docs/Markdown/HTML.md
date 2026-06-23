---
description: Inline and block-level HTML tags inside markdown.
tags: level/intermediate glossary
---

SilverBullet supports embedding raw HTML tags inside your markdown — both **inline** (mid-paragraph, in headings, in table cells) and **block-level** (HTML on its own lines). As with other [[Live Preview]] features, it is rendered live in the editor when the cursor is outside the tag, and falls back to raw source when the cursor enters it. Markdown inside the HTML tag is parsed and rendered too.

This is a power-user feature, use it carefully. There is no sanitization of HTML.

# Inline HTML
Use any HTML tag inside running text. For example:

This text is <u>underlined</u> and this is <mark>highlighted</mark>.

Inline HTML also works in headings and table cells:

## Heading with <u>underlined</u> bit

| Tag | Example |
|-----|---------|
| `<kbd>` | <kbd>Esc</kbd> |
| `<sub>` | H<sub>2</sub>O |

# Block-level HTML
Block-level HTML elements (`<div>`, `<details>`, `<figure>`, `<blockquote>`, etc.) on their own lines are recognized as HTML blocks. Markdown nested inside is still parsed:

<details>
<summary>Click to expand</summary>
Inner **markdown** with [[Markdown]] links works too.
</details>

# Notes
* Unmatched tags (e.g. an `<u>` with no closing `</u>`) render as literal text.
* Block-level HTML blocks terminate at the first blank line (per CommonMark). If you want a `<details>` (or any structured HTML block) to wrap markdown content, keep the entire block contiguous — no blank lines between the opening and closing tag.
* No sanitization is applied — HTML is rendered as-is, mirroring the read-only preview. Be mindful of what you embed (especially `<style>`, `<script>`, `<iframe>`).
* [[Space Style]] can be used to style these HTML tags
