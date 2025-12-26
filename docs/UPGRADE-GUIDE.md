# ThingsBoard Upgrade Guide

Step-by-step procedures for upgrading ThingsBoard from upstream releases while maintaining custom branding.

## Overview

This guide covers upgrading a white-labeled ThingsBoard fork while:
- Preserving custom branding (SignConnect)
- Maintaining upgrade compatibility
- Minimizing merge conflicts
- Ensuring rollback capability

## Pre-Upgrade Checklist

### Before Starting

- [ ] Backup current database
- [ ] Backup Docker volumes
- [ ] Note current version: `grep '<version>' pom.xml | head -1`
- [ ] Review upstream changelog for breaking changes
- [ ] Ensure clean git working directory: `git status`
- [ ] Confirm branding backup exists: `ls branding/originals/`

### Backup Commands

```bash
# Database backup
docker-compose exec postgres pg_dump -U postgres thingsboard > backup-$(date +%Y%m%d).sql

# Volume backup (if using Docker volumes)
docker run --rm -v docker_postgres-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres-data-$(date +%Y%m%d).tar.gz /data

# Git backup (create branch from current state)
git checkout -b backup-$(date +%Y%m%d)
git checkout master
```

## Upgrade Steps

### Step 1: Revert Custom Branding

Before merging upstream, revert to original ThingsBoard branding:

```bash
# Use revert script
./branding/scripts/revert-branding.sh

# Verify revert succeeded
grep "ThingsBoard" ui-ngx/src/index.html
# Should show: <title>ThingsBoard</title>

# Commit the revert
git add -A
git commit -m "chore: revert branding for upgrade"
```

**Why revert first?**
- Reduces merge conflicts
- Makes conflict resolution clearer
- Preserves original branding files in git history

### Step 2: Fetch Upstream Changes

```bash
# Add upstream remote (if not already done)
git remote add upstream https://github.com/thingsboard/thingsboard.git

# Fetch all upstream branches and tags
git fetch upstream --tags

# List available versions
git tag | grep "^v" | sort -V | tail -20
```

### Step 3: Create Upgrade Branch

```bash
# Create branch for upgrade work
git checkout -b upgrade/v4.3.0

# This allows easy rollback if upgrade fails
```

### Step 4: Merge Upstream Version

```bash
# Merge specific release tag
git merge v4.3.0

# Or merge release branch
git merge upstream/release-4.3

# Or merge latest master
git merge upstream/master
```

### Step 5: Resolve Merge Conflicts

#### Common Conflicts

| File | Strategy |
|------|----------|
| `pom.xml` | Accept upstream version, keep custom properties |
| `ui-ngx/package.json` | Accept upstream dependencies |
| `ui-ngx/angular.json` | Accept upstream, rarely customized |
| `locale.constant-*.json` | Accept both (theirs + ours), branding script will fix |
| `constants.scss` | Accept upstream, branding script will fix |
| Email templates | Accept upstream, branding script will fix |

#### Resolution Commands

```bash
# View all conflicts
git status

# For files that will be rebranded (accept upstream):
git checkout --theirs ui-ngx/src/scss/constants.scss
git checkout --theirs ui-ngx/src/index.html
git checkout --theirs ui-ngx/src/app/shared/components/footer.component.html

# For translation files (accept both, merge later):
git checkout --theirs ui-ngx/src/assets/locale/locale.constant-en_US.json

# For pom.xml (manual merge usually needed):
# - Keep upstream version number
# - Preserve any custom properties
# - Review dependency changes
code pom.xml  # Edit manually

# Mark resolved
git add <resolved-file>

# After all conflicts resolved:
git commit -m "chore: merge upstream v4.3.0"
```

#### Complex pom.xml Merge

```xml
<!-- Accept upstream version -->
<version>4.3.0</version>

<!-- Keep any custom plugins or properties you added -->
<properties>
    <!-- Upstream properties... -->

    <!-- Keep your custom properties -->
    <custom.docker.repo>myregistry</custom.docker.repo>
</properties>
```

### Step 6: Reapply Custom Branding

```bash
# Apply branding
./branding/scripts/apply-branding.sh

# Verify branding applied
grep "SignConnect" ui-ngx/src/index.html
# Should show: <title>SignConnect</title>

# Verify colors
grep "PRIMARY_COLOR" ui-ngx/src/scss/constants.scss

# Commit branding
git add -A
git commit -m "chore: reapply SignConnect branding after upgrade to v4.3.0"
```

### Step 7: Build and Test

```bash
# Clean and build
rm -rf ui-ngx/node_modules
./build.sh

# If build fails, check:
# - Node.js version compatibility
# - New dependencies that need configuration
# - Breaking API changes
```

### Step 8: Test Deployment

```bash
# Start test environment
cd docker
docker-compose down -v  # Fresh start
docker-compose up -d

# Wait for startup
sleep 60

# Verify application
curl http://localhost:8080/api/system/info

# Check logs for errors
docker-compose logs --tail=100 tb-core
```

### Step 9: Verification Checklist

- [ ] Application starts without errors
- [ ] Login page displays correctly with SignConnect branding
- [ ] Logo displays correctly
- [ ] Colors match brand palette
- [ ] Footer shows Lumosoft copyright
- [ ] Page title shows "SignConnect"
- [ ] Existing dashboards load
- [ ] Devices can connect
- [ ] Rule chains execute

### Step 10: Complete Upgrade

```bash
# Merge upgrade branch to master
git checkout master
git merge upgrade/v4.3.0

# Push to origin
git push origin master

# Tag the upgrade
git tag -a signconnect-4.3.0 -m "SignConnect based on ThingsBoard v4.3.0"
git push origin signconnect-4.3.0
```

## Rollback Procedure

If upgrade fails at any point:

### Before Merge Completed

```bash
# Abort merge
git merge --abort

# Return to clean state
git checkout master
```

### After Merge Completed

```bash
# Find previous working commit
git log --oneline -20

# Reset to previous state
git reset --hard <previous-commit-hash>

# If already pushed (use with caution):
git push -f origin master
```

### Database Rollback

```bash
# Stop application
docker-compose down

# Restore database
docker-compose up -d postgres
docker-compose exec -T postgres psql -U postgres thingsboard < backup-YYYYMMDD.sql

# Restart with old code version
git checkout <old-version>
./build.sh
docker-compose up -d
```

## Version-Specific Upgrade Notes

### Upgrading to 4.x from 3.x

Major changes to watch for:

1. **Java 17 Required**: Ensure build environment uses Java 17+
2. **Spring Boot 3.x**: Check for deprecated dependencies
3. **Angular 18**: Major UI framework upgrade
4. **Database Migrations**: Run upgrade scripts

```bash
# After deployment, run database upgrade
docker-compose exec tb-core /usr/share/thingsboard/bin/install/upgrade.sh
```

### Upgrading Minor Versions (e.g., 4.2 to 4.3)

Usually straightforward:
- Check for new configuration options
- Review new features that may affect branding
- Test new UI components with brand colors

## Files That Commonly Change

### High-Change Files (Expect Conflicts)

- `pom.xml` - Version numbers
- `ui-ngx/package.json` - Dependencies
- `ui-ngx/angular.json` - Build configuration
- Translation files - New strings added

### Branding Files (Will Be Overwritten by Script)

- `ui-ngx/src/index.html`
- `ui-ngx/src/scss/constants.scss`
- `ui-ngx/src/app/shared/components/footer.component.html`
- Logo/favicon files

### Rarely Changed Files

- Docker configurations
- Email templates (minor changes)
- Core Angular components

## Automated Upgrade Script

For routine upgrades, use the automation script:

```bash
./branding/scripts/upgrade.sh v4.3.0
```

This script:
1. Reverts branding
2. Fetches upstream
3. Merges specified version
4. Reapplies branding
5. Builds the project

**Note**: Still requires manual conflict resolution if conflicts occur.

## Monitoring Upstream Releases

### Stay Informed

- **GitHub Releases**: https://github.com/thingsboard/thingsboard/releases
- **Changelog**: https://thingsboard.io/docs/reference/releases/
- **Community Forum**: https://groups.google.com/forum/#!forum/thingsboard

### Recommended Upgrade Frequency

| Environment | Strategy |
|-------------|----------|
| Development | Track master, upgrade frequently |
| Staging | Monthly upgrades, test thoroughly |
| Production | Quarterly upgrades, after staging validation |
| Security | Apply patches immediately |

## Troubleshooting

### Build Fails After Merge

```bash
# Check for missing dependencies
mvn dependency:tree

# Clear caches
rm -rf ui-ngx/node_modules ui-ngx/.angular
cd ui-ngx && yarn install && yarn build:prod
```

### Database Migration Errors

```bash
# Check migration logs
docker-compose logs tb-core | grep -i "migration"

# Manual migration if needed
docker-compose exec tb-core /usr/share/thingsboard/bin/install/upgrade.sh --from-version=3.6.0
```

### UI Not Loading

```bash
# Check for JavaScript errors in browser console
# Verify static files exist
ls -la ui-ngx/target/generated-resources/public/

# Rebuild UI
cd ui-ngx && yarn build:prod
```

## Support

- See `.claude/skills/upgrade.md` for quick reference
- See `CLAUDE.md` for project overview
- See `branding/README.md` for branding system details
