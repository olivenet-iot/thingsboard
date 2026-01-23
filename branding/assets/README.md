# Brand Assets

Place your brand assets here. These will be copied to the appropriate locations when branding is applied.

## Required Files

| File | Dimensions | Format | Usage |
|------|------------|--------|-------|
| `logo_title_white.svg` | ~1500x320px | SVG | Sidebar logo (with text) |
| `logo_white.svg` | 320x320px | SVG | Sidebar icon (collapsed) |
| `favicon.ico` | 16,32,48,64px | ICO | Browser tab icon |

## Current Status

- [x] `logo_title_white.svg` - Lumosoft branded logo
- [x] `logo_white.svg` - Placeholder icon (update with actual SignConnect icon)
- [x] `favicon.ico` - Generated placeholder

## Specifications

### logo_title_white.svg
- Main logo displayed in sidebar header
- Should include company name/brand text
- **Color**: White (#FFFFFF) for icon, can use brand colors for text
- **Background**: Transparent
- **Format**: SVG (vector, scalable)
- Will display on dark primary color background

### logo_white.svg
- Square icon-only version
- Used in collapsed sidebar
- **Color**: White (#FFFFFF)
- **Background**: Transparent
- **Format**: SVG

### favicon.ico
- Browser tab/bookmark icon
- Multi-resolution ICO file containing:
  - 16x16px
  - 32x32px
  - 48x48px
  - 64x64px

## Design Guidelines

### Colors
- Primary: `#17212b` (Dark Navy)
- Secondary: `#f9b11d` (Golden Yellow)
- White text/icons on primary background

## Creating Custom Assets

### From Illustrator/Figma
1. Export as SVG
2. Ensure `fill="#fff"` for white elements
3. Remove any embedded fonts (convert to paths)
4. Optimize with SVGO if needed

### Creating Favicon

From a PNG source:

```bash
# Using ImageMagick
convert logo.png -resize 16x16 favicon-16.png
convert logo.png -resize 32x32 favicon-32.png
convert logo.png -resize 48x48 favicon-48.png
convert favicon-16.png favicon-32.png favicon-48.png favicon.ico
```

Or create with brand colors:

```bash
convert -size 64x64 xc:'#17212b' \
    -fill '#f9b11d' -font DejaVu-Sans-Bold \
    -pointsize 36 -gravity center \
    -annotate 0 "S" favicon.ico
```

Online tools:
- [favicon.io](https://favicon.io)
- [realfavicongenerator.net](https://realfavicongenerator.net)
