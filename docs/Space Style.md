---
description: "Custom CSS for the editor, defined in space-style code blocks."
tags: customization glossary
references:
- plugs/index/space_style.ts
- client/style.ts
---
Space Style is [[Space Lua]]’s stylish sibling. It enables you to add your own styling to SilverBullet with `space-style` [[Markdown/Fenced Code Block]]. Like `space-lua`, a `space-style` block only applies when it’s on a [[Tool Page]]: a page under `Library/`, or [[CONFIG]]. A block on any other page is shown but not applied, and gets a lint warning. The examples on this page are inert for that reason.

This can be used to achieve various things, such as overriding the default editor font or setting wider page widths. It is also possible to develop custom themes this way. To pick fonts, [[Fonts]] in Configuration is the easier route; a Space Style that sets a font variable wins over it.

To apply the updated styles, either reload the client or run the ${widgets.commandButton("System: Reload")} command.

Many styles can be set with [variables](https://github.com/silverbulletmd/silverbullet/blob/main/client/styles/theme.scss) but not everything is covered. You’ll have to reverse-engineer those parts, unfortunately.

For example: modal backdrops (behind pickers, prompts and confirmations) are fully transparent by default. To bring back a dimmed backdrop, set `--modal-backdrop-color`:

```space-style
html {
  /*--modal-backdrop-color: rgba(0, 0, 0, 0.15);*/
}
html[data-theme="dark"] {
  /*--modal-backdrop-color: rgba(0, 0, 0, 0.45);*/
}
```

# Load order
You can tweak the CSS load order style by including a `/* priority: number */` comment:

```space-style
/* priority: 10 */
somestyle {

}
```

Styles load in the same order as [[Space Lua#Definition loading|Space Lua scripts]]: by priority, highest first, where a block without a priority counts as `0`. Blocks with the same priority load in page name order, and blocks on the same page load top to bottom. Later styles win when selectors are equally specific. The [[Workbench/Code/Styles|Space Style]] section of the [[Workbench/Code|Code]] tab shows the actual order.

# Tone colours
SilverBullet defines six tones as CSS variables, with values for the light and the dark theme: `--tone-success`, `--tone-warning`, `--tone-danger`, `--tone-info`, `--tone-neutral` and `--tone-accent`. Each has a `-soft` variant for backgrounds (for example `--tone-danger-soft`). Your own styles can use them to stay readable in both themes:

```css
.overdue {
  color: var(--tone-danger);
  background: var(--tone-danger-soft);
}
```

# Tag Styling
You can add custom styles to a tag by leveraging the `data-tag-name` attribute, [CSS Attribute Selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors) and custom [[Space Style]]’s. Every tag gets an attribute added to it called `data-tag-name` that is set to the tag name with the `#` symbol stripped out. So given the tag #my-cool-tag the `data-tag-name` attribute would look like:

    data-tag-name="my-cool-tag"

This allows us to do things like change the color of the #my-cool-tag
to have a purple background, limegreen text and bold font by adding the following [[Space Style]]:

```css
.sb-hashtag[data-tag-name="my-cool-tag"] {
  background: purple;
  color: limegreen;
  font-weight: bolder;
}
```

Additionally tags written using angle brackets, such as...

    #<my cool tag>

...can be styled via [[Space Style]] like this:
```css
.sb-hashtag[data-tag-name="my cool tag"] {
  background: purple;
  color: limegreen;
  font-weight: bolder;
}
```
# More examples
All the actual CSS in these examples is commented out, so it stays harmless once you copy it into a page under `Library/`.
```space-style
html {
  /* Changes to the default theme */
  /* Such as the accent color */
  /*--ui-accent-color: #464cfc;*/
}

html[data-theme="dark"] {
  /* Changes to the dark theme */
  /*--ui-accent-color: #464cfc;*/
}

html {
  /* Uncomment the next line to set the editor font to Courier */
  /* --editor-font: "Courier" !important; */
  /* Code, frontmatter and Lua expressions use their own font, see [[Fonts]] */
  /* --editor-monospace-font: "Courier" !important; */
  /* Uncomment the next line to set the editor width to 1400px */
  /* --editor-width: 1400px !important; */
}

/* Choose another header color */
html {
  /*--top-background-color: #eee;*/
}
/* Or modify the element directly */
#sb-top {
  /*background-color: #eee !important;*/
}

/* You can even change the appearance of buttons */
button {
  /* align-items: center;
  background-color: #fff;
  border-radius: 6px;
  box-shadow: transparent 0 0 0 3px,rgba(18, 18, 18, .1) 0 6px 20px;
  box-sizing: border-box;
  color: #121212;
  cursor: pointer;
  display: inline-flex;
  flex: 1 1 auto;
  font-family: Inter,sans-serif;
  font-size: 0.6rem;
  justify-content: center;
  line-height: 1;
  margin: 0.2rem;
  outline: none;
  padding: 0.3rem 0.4rem;
  text-align: center;
  text-decoration: none;
  transition: box-shadow .2s,-webkit-box-shadow .2s;
  white-space: nowrap;
  border: 0;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation; */
}

button:hover {
  /* box-shadow: #121212 0 0 0 3px, transparent 0 0 0 0; */
}

/* Add custom styling to a specific tag
--> Example Tag: #my-cool-tag */
.sb-hashtag[data-tag-name="my-cool-tag"] {
  /* background: purple;
  color: limegreen;
  font-weight: bolder; */
}
/* --> Example Tag with angle brackets: #<my cool tag> */
.sb-hashtag[data-tag-name="my cool tag"] {
  /* background: purple;
  color: limegreen;
  font-weight: bolder; */
}
/* Custom Styling to all tags */
.sb-hashtag[data-tag-name] {
  /* background: yellow;
  color: goldenrod;
  border: 2px dashed goldenrod; */
}
```

Another example can be found in [[Page Decorations#Use case: pimp my page]]
