# Build Skill

Instructions for building ThingsBoard from source.

## Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| Java JDK | 17+ | `sudo apt install openjdk-17-jdk` |
| Maven | 3.6+ | `sudo apt install maven` |
| Docker | Latest | [Docker Install](https://docs.docker.com/engine/install/) |
| Git | Latest | `sudo apt install git` |

**Note**: Node.js and Yarn are automatically installed by Maven during build.

## Quick Build Commands

```bash
# Full build (all modules, skip tests)
./build.sh

# Full build with tests
mvn clean install

# Backend only (skip UI)
mvn clean install -DskipTests -pl '!ui-ngx'

# UI only
cd ui-ngx && yarn build:prod

# Specific module
./build.sh msa/web-ui

# With Docker images
mvn clean install -DskipTests -Ddockerfile.skip=false
```

## Full Build Process

### 1. Clone and Setup

```bash
git clone https://github.com/thingsboard/thingsboard.git
cd thingsboard
```

### 2. Build All Modules

```bash
# Set memory for large builds
export MAVEN_OPTS="-Xmx4g"
export NODE_OPTIONS="--max_old_space_size=4096"

# Full build
./build.sh
```

Build time: ~15-30 minutes depending on hardware.

### 3. Verify Build

```bash
# Check application JAR
ls -la application/target/thingsboard-*.jar

# Check UI build
ls -la ui-ngx/target/generated-resources/public/
```

## Partial Builds

### Backend Only

Skip UI build (faster for backend changes):

```bash
mvn clean install -DskipTests -pl '!ui-ngx'
```

### UI Only

For frontend-only changes:

```bash
cd ui-ngx
yarn install
yarn build:prod
```

Development mode with hot reload:

```bash
cd ui-ngx
yarn start
# UI available at http://localhost:4200
# Backend must be running on port 8080
```

### Single Module

Build specific module and its dependencies:

```bash
# Using build.sh
./build.sh msa/tb-node

# Using Maven
mvn clean install -DskipTests -pl msa/tb-node -am
```

## Docker Image Building

### Build All Docker Images

```bash
mvn clean install -DskipTests -Ddockerfile.skip=false
```

### Build Specific Image

```bash
# tb-node
cd msa/tb-node && mvn dockerfile:build

# web-ui
cd msa/web-ui && mvn dockerfile:build

# transports
cd msa/transport/mqtt && mvn dockerfile:build
```

### Multi-Architecture Build (AMD64 + ARM64)

```bash
mvn clean install -DskipTests -Ppush-docker-amd-arm-images
```

### Tag and Push Images

```bash
# Tag with version
docker tag thingsboard/tb-node:latest myregistry/signconnect:4.3.0

# Push
docker push myregistry/signconnect:4.3.0
```

## Build Profiles

| Profile | Description | Activation |
|---------|-------------|------------|
| `default` | Standard build | Active by default |
| `packaging` | Create DEB/RPM packages | Active by default |
| `yarn-build` | Build Angular UI | Active by default |
| `yarn-start` | Start UI dev server | `-Pyarn-start` |
| `push-docker-amd-arm-images` | Multi-arch Docker | `-Ppush-docker-amd-arm-images` |

## Build Configuration

### Memory Settings

```bash
# Maven JVM
export MAVEN_OPTS="-Xmx4g"

# Node.js (for UI build)
export NODE_OPTIONS="--max_old_space_size=4096"
```

### Skip Options

```bash
# Skip tests
-DskipTests

# Skip Docker
-Ddockerfile.skip=true

# Skip license check
-Dlicense.skip=true
```

### Parallel Build

```bash
# Use 4 threads
mvn -T4 clean install -DskipTests

# Use 1 thread per CPU core
mvn -T1C clean install -DskipTests
```

## Troubleshooting

### Out of Memory

```
Error: FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed
```

**Solution**: Increase Node.js memory:
```bash
export NODE_OPTIONS="--max_old_space_size=8192"
```

### Maven Memory Error

```
Error: Java heap space
```

**Solution**: Increase Maven memory:
```bash
export MAVEN_OPTS="-Xmx6g -XX:+UseG1GC"
```

### UI Build Fails

```bash
# Clear node_modules and rebuild
cd ui-ngx
rm -rf node_modules
rm yarn.lock
yarn install
yarn build:prod
```

### Docker Build Fails

```bash
# Check base images
docker pull thingsboard/openjdk17:bookworm-slim
docker pull thingsboard/node:22.18.0-bookworm-slim

# Clean Docker cache
docker builder prune -f
```

### Port Already in Use

```bash
# Find process
lsof -i :8080

# Kill process
kill -9 <PID>
```

### License Header Check Fails

```bash
# Format license headers
mvn license:format

# Then rebuild
mvn clean install -DskipTests
```

## Build Artifacts

After successful build:

| Artifact | Location |
|----------|----------|
| Application JAR | `application/target/thingsboard-*.jar` |
| Application DEB | `application/target/thingsboard.deb` |
| UI Static Files | `ui-ngx/target/generated-resources/public/` |
| Docker Images | Local Docker registry |

## CI/CD Integration

### GitHub Actions

```yaml
- name: Build ThingsBoard
  run: |
    export MAVEN_OPTS="-Xmx4g"
    export NODE_OPTIONS="--max_old_space_size=4096"
    mvn clean install -DskipTests
```

### Jenkins

```groovy
stage('Build') {
    sh '''
        export MAVEN_OPTS="-Xmx4g"
        export NODE_OPTIONS="--max_old_space_size=4096"
        ./build.sh
    '''
}
```

## Related Documentation

- See `CLAUDE.md` for project overview
- See `.claude/skills/deployment.md` for Docker deployment
- See `branding/scripts/build-image.sh` for branded image building
