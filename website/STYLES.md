If you create a [[STYLES]] page in your project, SilverBullet will look for a CSS code block inside that page and load it upon boot (an example can be found below).

This can be used to achieve various things, such as overriding the default editor font, or setting wider page widths. What CSS styles you can override is not very well documented, you’ll have to reverse engineer things a bit for now, unfortunately.

```css
#sb-root {
   /* Uncomment the next line to set the editor font to Courier */
   /* --editor-font: "Courier" !important; */
   /* Uncomment the next line to set the editor width to 1400px */
   /* --editor-width: 1400px !important; */
}
```