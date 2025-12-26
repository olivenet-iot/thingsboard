# Patches Directory

This directory is reserved for patch files that can be used as an alternative branding approach.

## Purpose

Patches provide a version-control-friendly way to track branding changes:
- Each change is recorded as a diff
- Patches can be applied/reverted cleanly
- Easier to review what changed
- Works well with `git` workflows

## Current Approach

The default branding system uses direct file modification via `apply-branding.sh`:

1. Backup original files
2. Modify files in place
3. Store backups in `originals/`

## Alternative: Patch-Based Approach

If you prefer patches:

### Creating Patches

After making branding changes manually:

```bash
# Create patch for single file
git diff ui-ngx/src/index.html > branding/patches/index.html.patch

# Create patch for all branding changes
git diff > branding/patches/all-branding.patch
```

### Applying Patches

```bash
# Apply single patch
patch -p1 < branding/patches/index.html.patch

# Apply all patches
patch -p1 < branding/patches/all-branding.patch
```

### Reverting Patches

```bash
# Revert single patch
patch -R -p1 < branding/patches/index.html.patch

# Revert all patches
patch -R -p1 < branding/patches/all-branding.patch
```

## Patch Files (If Used)

Example patch structure:

```
patches/
├── README.md           # This file
├── index.html.patch    # Page title, favicon
├── constants.scss.patch # Color variables
├── footer.patch        # Copyright footer
├── translations.patch  # Translation strings
└── emails.patch        # Email templates
```

## When to Use Patches

Consider patches when:
- You need fine-grained control over changes
- You want to review each change individually
- You're maintaining multiple brand variants
- You prefer `git diff` style change tracking

## When to Use Scripts

Use the script approach (`apply-branding.sh`) when:
- You want simple, automated branding
- Configuration is straightforward
- You don't need patch-level granularity

## Hybrid Approach

You can combine both:
1. Use `apply-branding.sh` for automated changes
2. Create patches for any additional customizations

```bash
# Apply automated branding
./scripts/apply-branding.sh

# Apply additional custom patches
patch -p1 < patches/custom-widget.patch
```

## Notes

- Patches are position-sensitive and may fail on upstream updates
- Always test patches after upgrading ThingsBoard
- Regenerate patches if they become stale
