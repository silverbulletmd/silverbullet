Space Style is [[Space Script]]‘s stylish sibling. It enables you to add your own styling to SilverBullet with `space-style` [[Blocks]].

This can be used to achieve various things, such as overriding the default editor font or setting wider page widths. It is also possible to develop custom themes this way. 

To apply the updated styles, either reload the client or run the {[System: Reload]} command.

Many styles can be set with [variables](https://github.com/silverbulletmd/silverbullet/blob/main/web/styles/theme.scss) but not everything is covered. You’ll have to reverse-engineer those parts, unfortunately.

# Examples
All the actual CSS in these examples is commented out as to not affect this very website. 
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
```
