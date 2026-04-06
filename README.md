# Pix Stream

A floating image gallery and slideshow platform. Drop images in, configure via a web admin panel, and serve a visually rich, animated gallery to the web -- or as a native app on desktop and mobile.

This project is based on [angular-momentum](https://github.com/TheGameKnave/angular-momentum), but is fully vibe-coded as a proof of concept.

## Goals

### 1. Image Gallery Site + Companion Apps

Provide site code that becomes a full image gallery with minimal configuration. The web site and native apps share the same functionality:

- Animated "river" of floating, rotating photo cards
- Lightbox viewer with navigation, download, share, and QR code
- Tag-based filtering and NSFW content gating
- Per-image metadata (copyright, tags) read from embedded IPTC/EXIF data
- Admin panel for uploading images, configuring themes, and managing settings
- Kiosk mode for unattended display
- PWA support for installable web apps
- Native apps via Tauri (macOS, Windows, Linux, Android, iOS)

### 2. Standalone Mobile Slideshow App (Planned)

Publish a standalone app that functions as a personal mobile slideshow. Instead of reading from a server cache, this mode would:

- Read photos directly from the device filesystem
- Support external image feeds (RSS, API endpoints, etc.)
- Function offline as a self-contained photo viewer

## Features

### Gallery
- Animated floating card layout with configurable flow direction (LTR, RTL, TTB, BTT) and speed
- Responsive column count based on viewport aspect ratio
- GSAP-powered animation with random rotation and gaussian-distributed positioning
- Click any card to open a full-size lightbox with keyboard/swipe navigation

### Image Management
- Upload images via drag-and-drop in the admin panel
- Supported formats: JPG, PNG, GIF, WebP (TIFF and PSD with Imagick)
- Automatic thumbnail generation (600x600 max) and full-size processing (2400x2400 max)
- Optional copyright banner composited onto processed images

### Metadata & Tags
- **Tags**: Extracted automatically from IPTC keywords (field `#2#025`) embedded in images. Use any photo editor (Lightroom, Bridge, ExifTool, etc.) to set keywords before uploading.
- **NSFW**: Add the keyword `nsfw` (case-insensitive) to any image to mark it as sensitive. These display with a blur by default; users can toggle visibility.
- **Copyright**: Read from the EXIF Copyright field. When a contact email is configured, a banner with the copyright info is composited onto processed images.
- **Tag filtering**: Admin can choose which tags appear in the UI. Tags display as a nav bar or multi-select dropdown.

### Admin Panel
- Password-protected setup wizard (first visit creates the password)
- Configure: site title, description, colors, fonts, logo, palette mode
- Toggle features: share, download, QR code, kiosk mode
- Upload and delete images
- Select visible tags and tag display mode
- Preview theme changes in real time

### Caching & Offline
- Service worker with configurable caching strategy
- Thumbnails cached (500 items, 30 days) and full images cached (100 items, 30 days)
- API responses cached network-first with fallback
- IndexedDB for client-side state persistence

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 21 (Zoneless), TypeScript 5.9, Tailwind CSS 4 |
| Animation | GSAP 3.12 |
| Backend | PHP 8 with GD (Imagick optional) |
| Native Apps | Tauri 2.9+ |
| PWA | Angular Service Worker |

## Quick Start

### Prerequisites

- Node 24.11.1 (recommend [NVM](https://github.com/nvm-sh/nvm))
- npm 10.8.1
- PHP 8+ with GD extension
- Angular CLI: `npm i -g @angular/cli`

### Install & Run

```bash
npm ci          # Install dependencies
npm run dev     # Run client (port 6200) + PHP server (port 8080) concurrently
```

Open [http://localhost:6200](http://localhost:6200) to view the gallery.

Navigate to `/admin` to set up your password and configure the site.

### Add Images

1. Go to `/admin` and log in
2. Drag and drop images into the upload area
3. Images are automatically processed (thumbnails, full-size, optional copyright banner)
4. Tags and copyright are read from embedded IPTC/EXIF metadata -- set these in your photo editor before uploading

### Favicon

The admin panel lets you upload an SVG or PNG favicon for browser tabs. For full cross-platform favicon support (Apple touch icons, Android manifest icons, Windows tiles, etc.), you'll need to generate multiple sizes and formats:

1. Start with a high-resolution source image (at least 512x512 PNG or an SVG)
2. Use a favicon generator service like [RealFaviconGenerator](https://realfavicongenerator.net/) or [favicon.io](https://favicon.io/) to produce the full set of formats and sizes
3. Place the generated files in `client/src/` and update `client/src/index.html` with the appropriate `<link>` tags

**Note:** Tauri handles its own app icon processing separately during the build step — see `src-tauri/icons/`. Tauri icon generation is outside the scope of the admin panel upload.

### Individual Scripts

```bash
npm run client      # Frontend only (port 6200)
npm run server      # PHP backend only (port 8080)
npm run build       # Production build
npm run build:prod  # Optimized production build
```

## Tests

```bash
npm test            # Full client test suite
npm run test:php    # PHP unit tests
npm run test:all    # Both
```

## Configuration

Site settings are stored in `server/config/site.json` and managed through the admin panel. Key options:

| Setting | Description |
|---------|-------------|
| `title` | Site name displayed in the header |
| `description` | Subtitle / tagline |
| `siteDescription` | Markdown content for the about panel |
| `headerColor` / `bgColor` | Theme colors |
| `fontBody` | Google Font name (18 presets available) |
| `flowDirection` | `rtl`, `ltr`, `ttb`, `btt` |
| `flowSpeed` | `off`, `low`, `med`, `high` |
| `enabledTags` | Array of tags to show in the UI (empty = all) |
| `tagDisplayMode` | `nav` (button bar) or `dropdown` (multi-select) |
| `nsfwBlurDefault` | Whether NSFW images are blurred by default |
| `contactEmail` | Enables copyright banner on processed images |
| `enableShare` / `enableDownload` / `enableQr` / `enableKiosk` | Feature toggles |

## Tauri (Native Apps)

This project uses Tauri to build native apps for macOS, Windows, Linux, Android, and iOS. You'll need Rust and platform-specific toolchains (Xcode, Android Studio). Tauri setup can be complex -- if you're new to native toolchains, lean heavily on the [Tauri docs](https://tauri.app/) and AI assistants to get your environment running.

From `client`, while running a local server:

```bash
npm run tauri:dev       # Desktop dev build
npm run tauri:android   # Android simulator
npm run tauri:ios       # iOS simulator
```

Production builds:

```bash
npm run tauri build                                          # Desktop (Win/Mac/Linux)
npm run tauri android dev                                    # Android
npm run tauri ios build -- --export-method app-store-connect  # iOS
```

### Standalone Android APK (Remote URL)

You can build a sideloadable Android APK that wraps any deployed pix-stream site in a native WebView. No frontend bundling needed — the app points at the remote URL.

```bash
./build-app.sh <url> <app-name> [icon-url]
```

Examples:

```bash
./build-app.sh https://maskphoto.com "Mask Photo"
./build-app.sh https://example.com/kiosk "My Gallery" https://example.com/icon.png
```

- If `icon-url` is omitted, fetches `<url>/api/favicon` automatically
- Generates all required icon sizes (Tauri + Android mipmaps)
- Signs the APK with a debug keystore for sideloading
- Output: `<app-name>.apk` in the project root

**Requirements:** Rust, Tauri CLI, Android SDK + NDK, `sips` (macOS), `curl`

**Install on device:**
```bash
adb install my-app.apk
```

## Deploying to Shared Hosting (Apache + PHP)

Pix Stream runs on any standard PHP host with Apache and mod_rewrite. No Node.js or build tools needed on your server.

### Build

```bash
./build.sh
```

This creates a `public_html/` directory at the project root containing everything your host needs — the PHP backend and the compiled Angular frontend, merged together and ready to upload.

Note: if you're not modifying the project and only want to deploy the frontend, this build has been run already and you can skip this step.

### Upload

Upload the entire contents of `public_html/` to your host's document root (usually called `public_html/` on the host as well).

On your host, create a `storage/` directory as a **sibling** of the document root (one level up, not inside it):

```
├── public_html/           ← upload public_html/ contents here
│   ├── .htaccess
│   ├── api/
│   ├── config/
│   ├── lib/
│   ├── index.html
│   ├── main.js
│   ├── assets/
│   └── ...
└── storage/               ← create this, must be writable
    ├── originals/
    ├── processed/
    └── thumbnails/
```

Make `storage/` and its subdirectories writable by the web server (`chmod 755` or `775`).

### After Upload

Visit your domain to see the gallery. Navigate to `/admin` to set your password and configure the site.

### Requirements

- PHP 8+ with GD extension (Imagick optional, enables TIFF/PSD support)
- Apache with mod_rewrite enabled
- `storage/` directory writable by the web server

## Project Structure

```
pix-stream/
├── client/                 # Angular frontend
│   └── src/
│       ├── app/
│       │   ├── components/ # Gallery, Lightbox, Admin, Kiosk
│       │   ├── services/   # Config, gallery state, connectivity
│       │   └── directives/ # Shared directives
│       └── assets/         # Styles, icons
├── server/
│   ├── api/                # PHP endpoints (manifest, config, upload, auth, etc.)
│   ├── config/             # site.json, .password
│   ├── lib/                # Image processing, scanning, auth helpers
│   └── tests/              # PHPUnit tests
└── storage/
    ├── originals/          # Uploaded source images
    ├── processed/          # Full-size processed images
    └── thumbnails/         # Generated thumbnails
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
