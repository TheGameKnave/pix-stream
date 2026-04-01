#!/usr/bin/env bash
# Build Pix Stream into a ready-to-upload public_html/ directory.
#
# Usage:
#   ./build.sh          # production build (default)
#   ./build.sh dev      # development build (unminified, with sourcemaps)
#
# Output: public_html/ at the project root — upload this to your web host.

set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${1:-production}"

echo "==> Building Angular client (${CONFIG})..."
cd client
npx ng build --configuration="$CONFIG"
cd ..

BUILD_DIR="client/dist/pix-stream/browser"
if [ ! -d "$BUILD_DIR" ]; then
  echo "ERROR: Build output not found at $BUILD_DIR"
  exit 1
fi

echo "==> Assembling public_html/..."
rm -rf public_html
mkdir -p public_html

# Server files (skip dev-only files)
cp server/.htaccess public_html/
cp -r server/api public_html/
cp -r server/config public_html/
cp -r server/lib public_html/

# Prevent leaking password file from config into build output
rm -f public_html/config/.password

# Client build output
cp -r "$BUILD_DIR"/* public_html/

# Rename Angular's CSR entry point to index.html
if [ -f public_html/index.csr.html ]; then
  mv public_html/index.csr.html public_html/index.html
fi

# Remove sourcemaps (not needed in production)
if [ "$CONFIG" = "production" ]; then
  find public_html -name '*.map' -delete
fi

# Remove SSR files (not used on shared hosting)
rm -f public_html/server.mjs public_html/main.server.mjs
rm -f public_html/index.server.html

# Write version stamp from git
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null; then
  git rev-parse --short HEAD > public_html/config/.version
fi

echo ""
echo "Done! Upload the contents of public_html/ to your web host."
echo "Storage directories are created automatically on first upload."
