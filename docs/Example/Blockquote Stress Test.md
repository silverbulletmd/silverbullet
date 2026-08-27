# Simple
> A simple one-line blockquote.

# Multi-line, same paragraph
> This blockquote wraps across two source lines
> and should read as one continuous paragraph.

# Multiple paragraphs
> First paragraph of the quote.
>
> Second paragraph of the quote, after a blank quoted line.

# Nested
> Outer level one.
>
> > Nested level two.
> >
> > > Nested level three.

# Bullet list inside
> Intro line before the list.
>
> * first item
> * second item
>   * nested item
> * third item
> * a deliberately long list item inside a quote that wraps over several rows so the wrapped rows can be checked against the item's own hanging indent as well as against the quote bar

# Task list inside
> * [ ] unchecked task in a quote
> * [x] checked task in a quote

# Ordered list inside
> 1. one
> 2. two
> 3. three

# Heading and code inside
> # Quoted heading
>
> Some `inline code` and a fenced block:
>
> ```lua
> print("hello")
> ```

# Nested heading inside
> Body line at level one.
>
> > # Heading nested two deep
> >
> > Body line at level two.

# Admonitions
> **note** This is a note admonition.
> It has a second line, which must share the first line's tint.

> **warning** This is a warning admonition.

# Quote inside a list item
* A list item
  > with a blockquote inside it
* Another item

# Lazy continuation
> Quoted line one
continued without a marker

# Adjacent quotes
> First quote.

> Second, separate quote.
