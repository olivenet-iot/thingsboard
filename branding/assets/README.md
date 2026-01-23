# Brand Assets

Place your brand assets here. These will be copied to the appropriate locations when branding is applied.

## Required Files

| File | Dimensions | Format | Usage |
|------|------------|--------|-------|
| `logo_title_white.svg` | ~1500x500px | SVG | Sidebar logo (with text) |
| `logo_white.svg` | ~100x100px | SVG | Small icon |
| `favicon.ico` | 16,32,48,64px | ICO | Browser tab icon |

## Specifications

### logo_title_white.svg
- Main logo displayed in sidebar header
- Should include company name/brand text
- **Color**: White (#FFFFFF) or light color
- **Background**: Transparent
- **Format**: SVG (vector, scalable)
- Will display on dark background

### logo_white.svg
- Square icon-only version
- Used for compact displays
- **Color**: White (#FFFFFF)
- **Background**: Transparent
- **Format**: SVG

### favicon.ico
- Browser tab/bookmark icon
- Multi-resolution ICO file containing:
  - 16x16px
  - 32x32px
  - 48x48px
  - 64x64px (optional)

## Creating Favicon

From a PNG source:

```bash
# Using ImageMagick
convert logo.png -resize 16x16 favicon-16.png
convert logo.png -resize 32x32 favicon-32.png
convert logo.png -resize 48x48 favicon-48.png
convert favicon-16.png favicon-32.png favicon-48.png favicon.ico

# Using online tools
# - favicon.io
# - realfavicongenerator.net
```

## Current Assets

- [x] logo_title_white.svg (Lumosoft logo)
- [ ] logo_white.svg (TODO)
- [ ] favicon.ico (TODO)
