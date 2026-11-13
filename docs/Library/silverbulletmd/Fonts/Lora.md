---
name: Library/silverbulletmd/Fonts/Lora
tags: meta/library
description: Lora, a serif with brushed, calligraphic curves, to pick as your editor or interface font.
files:
- Lora/Lora-Variable.ttf
- Lora/Lora-Italic-Variable.ttf
- Lora/OFL.txt
share.uri: "github:silverbulletmd/silverbullet-libraries@main/Library/silverbulletmd/Fonts/Lora.md"
share.mode: pull
share.hash: a522bff7
---
**Lora** is a contemporary serif with roots in calligraphy, by Cyreal. Its brushed curves give long paragraphs some warmth without getting fussy.

Installing this library adds Lora to the fonts in Configuration → Appearance. Choose it as the Editor font (or Interface font) there, or in `Library/Config` with `config.set("fonts.editor", "lora")`. The font files install into your space, so it works offline and loads nothing from elsewhere; a browser only downloads a style once text uses it. Each style is one variable font file that covers every weight.

# License
Lora is licensed under the SIL Open Font License 1.1, with Reserved Font Name “Lora”; the license text ships alongside the font files as `Lora/OFL.txt`. The files are byte for byte the project's own (only renamed, dropping the `[wght]` part that URLs handle badly) from https://github.com/google/fonts/tree/main/ofl/lora (Lora-Variable.ttf 212,196 bytes; Lora-Italic-Variable.ttf 221,232 bytes).

# Implementation
```space-lua
config.set("fonts.available.lora", {
  name = "Lora",
  family = "Lora, Georgia, serif",
  kind = "serif",
  faces = {
    { src = "Library/silverbulletmd/Fonts/Lora/Lora-Variable.ttf", weight = 400 },
    { src = "Library/silverbulletmd/Fonts/Lora/Lora-Variable.ttf", weight = 700 },
    { src = "Library/silverbulletmd/Fonts/Lora/Lora-Italic-Variable.ttf", weight = 400, style = "italic" },
    { src = "Library/silverbulletmd/Fonts/Lora/Lora-Italic-Variable.ttf", weight = 700, style = "italic" },
  },
  license = "OFL-1.1",
})
```
