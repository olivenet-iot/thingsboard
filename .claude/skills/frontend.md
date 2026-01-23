# ThingsBoard Frontend Guide

## Overview

Angular 18.2.13 application with Material Design, NgRx state management, and comprehensive i18n support.

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Angular | 18.2.13 | Framework |
| Angular Material | 18.2.14 | UI Components |
| NgRx | 18.1.1 | State Management |
| Tailwind CSS | 3.4.15 | Utility Styling |
| ECharts | 5.5.1 | Charts/Visualization |
| @ngx-translate | 16.0.0 | Internationalization |

## Directory Structure

```
ui-ngx/src/
├── app/
│   ├── core/                    # Core services, guards, interceptors
│   │   ├── services/            # Auth, API, notification services
│   │   ├── guards/              # Route guards
│   │   └── interceptors/        # HTTP interceptors
│   ├── shared/                  # Shared components, directives, pipes
│   │   ├── components/          # Reusable UI components
│   │   ├── directives/          # Custom directives
│   │   └── pipes/               # Custom pipes
│   ├── modules/                 # Feature modules
│   │   ├── home/                # Main dashboard
│   │   ├── login/               # Authentication
│   │   ├── device/              # Device management
│   │   ├── dashboard/           # Dashboard designer
│   │   ├── widget/              # Widget library
│   │   ├── rule-chain/          # Rule chain editor
│   │   └── ...                  # 30+ feature modules
│   └── app.module.ts            # Root module
├── assets/
│   ├── locale/                  # Translation files (27 languages)
│   ├── help/                    # Help markdown files
│   └── *.svg                    # Logo and icon assets
├── scss/
│   ├── constants.scss           # Brand colors, spacing
│   ├── _mixins.scss             # SCSS mixins
│   └── styles.scss              # Global styles
├── theme.scss                   # Material theme configuration
└── index.html                   # Entry HTML
```

## Key Files

### Brand Colors
**File**: `ui-ngx/src/scss/constants.scss` (lines 34-39)
```scss
$tb-primary-color: #305680;      // Primary blue
$tb-secondary-color: #527dad;    // Secondary blue
$tb-hue3-color: #a7c1de;         // Light blue
$tb-dark-primary-color: #9fa8da; // Dark mode primary
```

### Material Theme
**File**: `ui-ngx/src/theme.scss`
- Defines Material Design color palettes
- Configures light/dark themes
- Sets typography scales

### Page Title
**File**: `ui-ngx/src/index.html` (line 22)
```html
<title>ThingsBoard</title>
```

### Environment Configuration
**Files**: `ui-ngx/src/environments/`
- `environment.ts` - Development config
- `environment.prod.ts` - Production config

Key settings:
```typescript
export const environment = {
  appTitle: 'ThingsBoard',
  production: false
};
```

## Translations (i18n)

### Location
`ui-ngx/src/assets/locale/locale.constant-{lang}.json`

### Supported Languages (27)
ar_AE, cs_CZ, da_DK, de_DE, en_US, es_ES, fa_IR, fi_FI, fr_FR, hi_IN, hu_HU, id_ID, it_IT, ja_JP, ko_KR, ms_MY, nl_BE, nl_NL, pl_PL, pt_BR, pt_PT, ru_RU, th_TH, tr_TR, uk_UA, vi_VN, zh_CN, zh_TW

### Adding Translations
1. Add key to `locale.constant-en_US.json`
2. Use in template: `{{ 'key.name' | translate }}`
3. Optionally add to other language files

### Key Translation Sections
```json
{
  "action": { "add": "Add", "edit": "Edit", ... },
  "device": { "device": "Device", "devices": "Devices", ... },
  "dashboard": { ... },
  "widget": { ... },
  "login": { ... },
  "home": { ... }
}
```

## State Management (NgRx)

### Store Location
`ui-ngx/src/app/core/store/`

### Key State Slices
- `auth` - Authentication state
- `settings` - User preferences
- `notification` - Toast notifications

### Usage Pattern
```typescript
// Select from store
this.store.select(selectAuthUser);

// Dispatch action
this.store.dispatch(AuthActions.login({ credentials }));
```

## Key Components

### Login Component
`ui-ngx/src/app/modules/login/`
- Login page with OAuth support
- Password reset flow
- Two-factor authentication

### Dashboard Component
`ui-ngx/src/app/modules/dashboard/`
- Dashboard viewer and editor
- Widget grid layout
- State management

### Widget Library
`ui-ngx/src/app/modules/widget/`
- 100+ built-in widgets
- Widget development SDK
- Custom widget support

### Rule Chain Editor
`ui-ngx/src/app/modules/rule-chain/`
- Visual rule chain designer
- Node configuration dialogs
- Connection management

## Widget Development

### Widget Types
1. **Latest values** - Real-time telemetry
2. **Time-series** - Historical charts
3. **RPC** - Device control
4. **Alarm** - Alarm widgets
5. **Static** - HTML/Markdown

### Widget Structure
```
widget/
├── widget.component.ts      # Main component
├── widget.component.html    # Template
├── widget.component.scss    # Styles
└── widget.models.ts         # Type definitions
```

### Custom Widget API
```typescript
self.onInit = function() {
  // Widget initialization
};

self.onDataUpdated = function() {
  // Handle telemetry updates
};

self.onResize = function() {
  // Handle container resize
};
```

## Build Commands

```bash
# Development server (hot reload)
cd ui-ngx && yarn start
# Available at http://localhost:4200

# Production build
cd ui-ngx && yarn build:prod

# Build with source maps
cd ui-ngx && yarn build

# Run tests
cd ui-ngx && yarn test

# Lint
cd ui-ngx && yarn lint
```

## Common Customizations

### Change Logo
Replace files:
- `ui-ngx/src/assets/logo_title_white.svg` (login page)
- `ui-ngx/src/assets/logo_white.svg` (sidebar icon)

### Change Favicon
Replace: `ui-ngx/src/thingsboard.ico`

### Modify Footer
Edit: `ui-ngx/src/app/shared/components/footer.component.html`

### Add Custom Component
1. Create component in appropriate module
2. Add to module declarations
3. Export if shared

## Troubleshooting

### Build Out of Memory
```bash
export NODE_OPTIONS="--max_old_space_size=8192"
```

### Clear Cache
```bash
cd ui-ngx
rm -rf node_modules/.cache
rm -rf dist
```

### Reinstall Dependencies
```bash
cd ui-ngx
rm -rf node_modules
yarn install
```
