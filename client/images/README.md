# Usage

## Icons

- **apple-touch-icon.png**  
  Used for `rel="apple-touch-icon"`

- **favicon-96x96.png**  
  PNG favicon (optimized for retina displays)

- **favicon.ico**  
  Standard shortcut favicon

- **favicon.svg**  
  Scalable SVG favicon

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
  Original high-resolution logo (reference only)

- **logo.png**  
  Used for `property="og:image"` (social preview image)
