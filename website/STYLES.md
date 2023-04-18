If you create a [[STYLES]] page in your project, SilverBullet will look for a CSS code block inside that page and load it upon boot (an example can be found below).

This can be used to achieve various things, such as overriding the default editor font, or setting wider page widths. What CSS styles you can override is not very well documented, you’ll have to reverse engineer things a bit for now, unfortunately.

```css
#sb-root {
   /* Uncomment the next line to set the editor font to Courier */
   /* --editor-font: "Courier" !important; */
   /* Uncomment the next line to set the editor width to 1400px */
   /* --editor-width: 1400px !important; */
}

/* Choose another header color */
#sb-top {
    /* background-color: #ffe54a !important; */
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
```
