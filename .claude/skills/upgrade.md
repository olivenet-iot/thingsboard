# Upgrade Skill

Instructions for upgrading ThingsBoard from upstream releases.

## Quick Upgrade

```bash
# 1. Revert branding
./branding/scripts/revert-branding.sh

# 2. Fetch upstream changes
git fetch upstream

# 3. Merge new version
git merge upstream/release-X.Y

# 4. Resolve conflicts (if any)
# ... manual resolution ...

# 5. Reapply branding
./branding/scripts/apply-branding.sh

# 6. Build and test
./build.sh
```

## Prerequisites

### Set Up Upstream Remote

```bash
# Add ThingsBoard upstream (one-time)
git remote add upstream https://github.com/thingsboard/thingsboard.git

# Verify remotes
git remote -v
# origin    git@github.com:your-org/thingsboard-fork.git (fetch)
# upstream  https://github.com/thingsboard/thingsboard.git (fetch)
```

## Upgrade Process

### Step 1: Prepare

```bash
# Ensure clean working directory
git status

# Stash any uncommitted changes
git stash

# Check current version
grep '<version>' pom.xml | head -1
```

### Step 2: Revert Branding

```bash
# Run revert script
./branding/scripts/revert-branding.sh

# Verify revert
grep "ThingsBoard" ui-ngx/src/index.html

# Commit the revert
git add -A
git commit -m "Revert branding for upgrade"
```

### Step 3: Fetch Upstream

```bash
# Fetch all upstream branches and tags
git fetch upstream --tags

# List available releases
git tag | grep "^v" | tail -10
```

### Step 4: Merge Upstream

Option A: Merge specific release tag
```bash
git merge v3.7.0
```

Option B: Merge release branch
```bash
git merge upstream/release-3.7
```

Option C: Merge master (latest)
```bash
git merge upstream/master
```

### Step 5: Resolve Conflicts

Common conflict files:

| File | Resolution Strategy |
|------|---------------------|
| `pom.xml` | Keep upstream version, preserve custom properties |
| `ui-ngx/package.json` | Keep upstream versions |
| `locale.constant-*.json` | Accept both (may need merge) |
| Branding files | Will be overwritten by apply-branding |

```bash
# View conflicts
git status

# For each conflicted file:
git diff <file>

# After resolving:
git add <file>

# Complete merge
git commit
```

### Step 6: Reapply Branding

```bash
# Run apply script
./branding/scripts/apply-branding.sh

# Verify branding
grep "SignConnect" ui-ngx/src/index.html

# Commit branding
git add -A
git commit -m "Reapply SignConnect branding after upgrade to vX.Y.Z"
```

### Step 7: Build and Test

```bash
# Full build
./build.sh

# Quick test
cd docker && docker-compose up -d
```

### Step 8: Push Changes

```bash
git push origin master
```

## Conflict Resolution Guide

### pom.xml Conflicts

```xml
<!-- Keep upstream version -->
<version>3.7.0</version>

<!-- Preserve any custom properties -->
<properties>
    <custom.property>value</custom.property>
</properties>
```

### Translation File Conflicts

For `locale.constant-*.json`:

```bash
# Usually accept both changes
# ThingsBoard might add new keys
# Your branding changes will be reapplied by script
git checkout --theirs ui-ngx/src/assets/locale/
```

### SCSS Conflicts

For `constants.scss`:

```bash
# Accept upstream, branding script will reapply colors
git checkout --theirs ui-ngx/src/scss/constants.scss
```

## Version-Specific Notes

### Major Version Upgrades (e.g., 3.x to 4.x)

- Review migration guides at https://thingsboard.io/docs/
- Database schema may change
- Run database upgrade scripts after deployment

### Minor Version Upgrades (e.g., 3.6 to 3.7)

- Usually backward compatible
- Review changelog for breaking changes
- Test thoroughly before production

## Upgrade Testing Checklist

### Build Verification
- [ ] Maven build completes without errors
- [ ] UI build completes without errors
- [ ] Docker images build successfully

### Branding Verification
- [ ] Logo displays correctly
- [ ] Colors match brand palette
- [ ] Footer shows correct copyright
- [ ] Page title is correct
- [ ] Favicon displays correctly

### Functional Testing
- [ ] Login page works
- [ ] Dashboard loads
- [ ] Device creation works
- [ ] Rule chains execute
- [ ] API endpoints respond

### Regression Testing
- [ ] Custom integrations work
- [ ] Existing dashboards display correctly
- [ ] Historical data accessible

## Rollback Procedure

If upgrade fails:

```bash
# Find previous commit
git log --oneline -10

# Reset to previous state
git reset --hard <previous-commit>

# Force push if already pushed (careful!)
git push -f origin master
```

## Automating Upgrades

### upgrade.sh Script

```bash
#!/bin/bash
# branding/scripts/upgrade.sh

VERSION=$1

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 v3.7.0"
    exit 1
fi

# Revert branding
./branding/scripts/revert-branding.sh

# Fetch and merge
git fetch upstream --tags
git merge $VERSION

if [ $? -ne 0 ]; then
    echo "Merge conflicts detected. Resolve manually."
    exit 1
fi

# Reapply branding
./branding/scripts/apply-branding.sh

# Build
./build.sh
```

## Keeping Up with Releases

### Monitor Releases

- Watch: https://github.com/thingsboard/thingsboard/releases
- Subscribe to announcements

### Release Cadence

ThingsBoard typically releases:
- Major versions: ~yearly
- Minor versions: ~quarterly
- Patch versions: as needed

### Recommended Schedule

- **Development**: Track master for latest features
- **Production**: Stay 1-2 minor versions behind for stability
- **Security**: Apply patches immediately

## Related Documentation

- See `docs/UPGRADE-GUIDE.md` for detailed procedures
- See `.claude/skills/build.md` for build instructions
- See `.claude/skills/white-label.md` for branding procedures
- See `branding/scripts/upgrade.sh` for automation
