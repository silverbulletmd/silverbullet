# Usage

## Icons

- **apple-touch-icon.png**  
  Used for `rel="apple-touch-icon"`

- **favicon-96x96.png**  
  PNG favicon (optimized for retina displays)

- **favicon.ico**  
  Standard shortcut favicon

- **favicon.svg**  
  SVG-wrapped 256px raster favicon. 
## Logos

- **logo-dock.png**  
  Logo used for PWA docking

- **logo-dock-96x96.png**  
  The same dock icon for inline use in the UI (the Space Manager's wordmark),
  where the 1024px original would be 405 KB to draw ~26 px. Regenerate from the
  original after any change to it:

  ```
  magick client/images/logo-dock.png -trim +repage -resize 96x96 -strip \
    PNG32:client/images/logo-dock-96x96.png
  ```

  `-trim` drops the original's transparent margin so the file's box is the icon
  itself (plus its drop shadow) — a CSS size then means what it says.

- **logo-large.png**  
  Original high-resolution logo (reference only, not shipped in the bundle)

- **logo.png**  
  Used for `property="og:image"` (social preview image)

## Optimizing

Every PNG here that ships in the client bundle is palette-quantized. The
gradient art compresses badly as truecolor: unquantized, these five files were
890 KB of a 3 MB cold load, and images are the one category HTTP compression
cannot shrink. Re-run this after replacing any of them, including after the
`logo-dock-96x96.png` regeneration above:

```
pngquant --quality=80-95 --speed 1 --force --ext .png \
  apple-touch-icon.png favicon-96x96.png logo-dock-96x96.png \
  logo-dock.png logo.png
```

At that quality the result is indistinguishable from the source at any size the
icons are drawn (RMSE < 0.8%), and each file lands 74-85% smaller.
