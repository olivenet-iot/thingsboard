# Brand Assets

Place your custom brand assets in this directory.

## Required Files

### logo_title_white.svg

**Purpose**: Main logo with company/product name text

**Specifications**:
- **Format**: SVG (vector)
- **Dimensions**: ~1543 x 320 pixels (or proportional)
- **Color**: White (#FFFFFF) on transparent background
- **Usage**: Login page header, sidebar, navigation

**Tips**:
- Use a vector graphics editor (Inkscape, Illustrator, Figma)
- Ensure text is converted to paths for consistency
- Test visibility on both light and dark backgrounds
- Keep file size reasonable (<50KB)

### logo_white.svg

**Purpose**: Icon-only logo (no text)

**Specifications**:
- **Format**: SVG (vector)
- **Dimensions**: Square, ~100 x 100 pixels recommended
- **Color**: White (#FFFFFF) on transparent background
- **Usage**: Loading screens, compact header views, mobile

**Tips**:
- Should be recognizable at small sizes
- Simple, clean design works best
- Test at 16x16, 32x32, and 64x64 sizes

### favicon.ico

**Purpose**: Browser tab icon

**Specifications**:
- **Format**: ICO (Windows icon format)
- **Sizes**: Multi-size: 16x16, 32x32, 48x48, 64x64 pixels
- **Color**: Full color (matches brand)
- **Usage**: Browser tabs, bookmarks, shortcuts

**Creating from PNG**:

Using ImageMagick:
```bash
convert logo.png -define icon:auto-resize=64,48,32,16 favicon.ico
```

Using online tools:
- https://favicon.io/
- https://realfavicongenerator.net/

## Optional Files

### logo_dark.svg

For light backgrounds (if different from white logo):
- **Color**: Dark version of logo
- **Usage**: Light-themed areas, print materials

### logo_color.svg

Full-color version:
- **Color**: Brand colors
- **Usage**: Marketing, documentation

## Asset Checklist

Before applying branding, verify:

- [ ] `logo_title_white.svg` exists and displays correctly
- [ ] `logo_white.svg` exists and is recognizable at small sizes
- [ ] `favicon.ico` contains multiple sizes
- [ ] All assets are on transparent backgrounds
- [ ] White logos are actually white (#FFFFFF)
- [ ] SVG files open correctly in browser

## Testing Assets

### Quick Browser Test

1. Open SVG files directly in browser
2. Check against dark background
3. Zoom in/out to test scaling

### In-Application Test

1. Apply branding: `./scripts/apply-branding.sh --dry-run`
2. Build UI: `cd ../ui-ngx && yarn build:prod`
3. Start application and check all pages

## Color Guidelines

Your assets should complement the color palette in `config.env`:

| Element | Hex Color | Usage |
|---------|-----------|-------|
| Primary | #305680 | Main UI, buttons |
| Secondary | #527dad | Secondary elements |
| Accent | #a7c1de | Highlights, borders |

## File Naming

Keep original ThingsBoard names for drop-in replacement:

| Your Asset | Target Name |
|------------|-------------|
| SignConnect logo | `logo_title_white.svg` |
| SignConnect icon | `logo_white.svg` |
| SignConnect favicon | `favicon.ico` |

## Troubleshooting

### Logo Not Displaying

- Check file permissions: `chmod 644 *.svg`
- Verify SVG is valid: open in browser
- Clear browser cache after updating

### Favicon Not Updating

- Clear browser cache completely
- Try incognito/private window
- Verify ICO contains expected sizes:
  ```bash
  identify favicon.ico
  ```

### Colors Look Wrong

- Ensure SVG uses `fill="#FFFFFF"` not CSS
- Check for embedded color profiles
- Verify transparent background (not white)

## Examples

### Converting PNG to SVG

Using Inkscape CLI:
```bash
inkscape logo.png --export-type=svg --export-filename=logo.svg
```

Note: This creates a rasterized SVG. For true vectors, recreate manually.

### Optimizing SVG

Using SVGO:
```bash
npx svgo logo.svg -o logo-optimized.svg
```

### Creating Multi-Size Favicon

```bash
# From SVG
inkscape logo.svg --export-type=png --export-width=64 --export-filename=logo-64.png
inkscape logo.svg --export-type=png --export-width=48 --export-filename=logo-48.png
inkscape logo.svg --export-type=png --export-width=32 --export-filename=logo-32.png
inkscape logo.svg --export-type=png --export-width=16 --export-filename=logo-16.png

# Combine into ICO
convert logo-64.png logo-48.png logo-32.png logo-16.png favicon.ico

# Cleanup
rm logo-*.png
```
