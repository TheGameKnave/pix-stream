#!/usr/bin/env bash
# Build a standalone Android APK that wraps a remote pix-stream site.
#
# Usage:
#   ./build-app.sh <url> <app-name> [icon-url]
#
# Examples:
#   ./build-app.sh https://maskphoto.com "Mask Photo"
#   ./build-app.sh https://maskphoto.com "Mask Photo" https://maskphoto.com/api/favicon
#
# If icon-url is omitted, fetches <url>/api/favicon automatically.
# Requires: cargo, tauri CLI, Android SDK, sips (macOS), curl

set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <url> <app-name> [icon-url]"
  echo "  url       — the remote site URL (e.g. https://maskphoto.com)"
  echo "  app-name  — display name for the app (e.g. \"Mask Photo\")"
  echo "  icon-url  — optional icon URL (defaults to <url>/api/favicon)"
  exit 1
fi

SITE_URL="$1"
APP_NAME="$2"
ICON_URL="${3:-${SITE_URL%/}/api/favicon}"

# Derive identifiers from app name
APP_ID=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '.' | sed 's/^\.//;s/\.$//')
IDENTIFIER="app.pixstream.${APP_ID}"

echo "==> Building Android app"
echo "    Site:       $SITE_URL"
echo "    App name:   $APP_NAME"
echo "    Identifier: $IDENTIFIER"
echo "    Icon:       $ICON_URL"
echo ""

# --- 1. Fetch and generate icons ---
echo "==> Fetching icon..."
ICON_DIR="$(mktemp -d)"
ICON_RAW="$ICON_DIR/icon_raw"
ICON_SRC="$ICON_DIR/icon_src.png"
curl -fsSL -o "$ICON_RAW" "$ICON_URL" || {
  echo "WARNING: Could not fetch icon from $ICON_URL, using default"
  cp client/src-tauri/icon.png "$ICON_RAW"
}
# Convert to PNG if not already (handles GIF, JPEG, ICO, etc.)
sips -s format png "$ICON_RAW" --out "$ICON_SRC" >/dev/null 2>&1 || cp "$ICON_RAW" "$ICON_SRC"

echo "==> Generating icon sizes..."
TAURI_ICONS="client/src-tauri/icons"
# Tauri icon sizes needed for the icon set
for size in 32 64 128 256; do
  sips -z $size $size "$ICON_SRC" --out "$TAURI_ICONS/${size}x${size}.png" >/dev/null 2>&1
done
sips -z 256 256 "$ICON_SRC" --out "$TAURI_ICONS/128x128@2x.png" >/dev/null 2>&1
cp "$TAURI_ICONS/256x256.png" "$TAURI_ICONS/icon.png" 2>/dev/null || true

# Android mipmap sizes: mdpi=48, hdpi=72, xhdpi=96, xxhdpi=144, xxxhdpi=192
ANDROID_RES="client/src-tauri/gen/android/app/src/main/res"
generate_mipmaps() {
  local src="$1"
  for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
    local density="${pair%%:*}" sz="${pair##*:}"
    local dir="$ANDROID_RES/mipmap-${density}"
    mkdir -p "$dir"
    sips -z "$sz" "$sz" "$src" --out "$dir/ic_launcher.png" >/dev/null 2>&1
    sips -z "$sz" "$sz" "$src" --out "$dir/ic_launcher_round.png" >/dev/null 2>&1
    local fg_sz=$((sz * 108 / 48))
    sips -z "$fg_sz" "$fg_sz" "$src" --out "$dir/ic_launcher_foreground.png" >/dev/null 2>&1
  done
}
generate_mipmaps "$ICON_SRC"
ICON_SRC_COPY="$TAURI_ICONS/icon_src.png"
cp "$ICON_SRC" "$ICON_SRC_COPY"
rm -rf "$ICON_DIR"

# --- 2. Patch tauri.conf.json ---
echo "==> Patching tauri.conf.json..."
TAURI_CONF="client/src-tauri/tauri.conf.json"

# Save original to restore later
cp "$TAURI_CONF" "$TAURI_CONF.bak"

# Use node to patch JSON cleanly
node -e "
const fs = require('fs');
const conf = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8'));
conf.productName = $(printf '%s' "$APP_NAME" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))");
conf.identifier = '$IDENTIFIER';
conf.build.frontendDist = '$SITE_URL';
conf.build.beforeBuildCommand = '';
conf.build.beforeDevCommand = '';
conf.app.windows[0].title = conf.productName;
fs.writeFileSync('$TAURI_CONF', JSON.stringify(conf, null, 2));
"

# --- 3. Reinitialize Android project with correct identifier ---
echo "==> Initializing Android project..."
cd client
# Remove stale gen to force regeneration with new identifier
rm -rf src-tauri/gen/android
npx tauri android init 2>&1

# Enable WebView debugging for inspection
MAIN_ACTIVITY=$(find src-tauri/gen/android -name "MainActivity.kt" 2>/dev/null | head -1)
if [ -n "$MAIN_ACTIVITY" ]; then
  # Add WebView.setWebContentsDebuggingEnabled(true) to onCreate
  sed -i '' 's/enableEdgeToEdge()/enableEdgeToEdge()\n    android.webkit.WebView.setWebContentsDebuggingEnabled(true)/' "$MAIN_ACTIVITY"
fi

# Re-apply icons after regeneration
cd ..
generate_mipmaps "$ICON_SRC_COPY"

# --- 4. Build Android APK ---
echo "==> Building Android APK..."
cd client
npx tauri android build --apk 2>&1
BUILD_EXIT=$?
cd ..

# --- 5. Restore original config ---
echo "==> Restoring original tauri.conf.json..."
mv "$TAURI_CONF.bak" "$TAURI_CONF"
rm -f "$ICON_SRC_COPY"

if [ $BUILD_EXIT -ne 0 ]; then
  echo "ERROR: Android build failed"
  exit 1
fi

# --- 6. Sign the APK ---
APK=$(find client/src-tauri/gen/android -name "*.apk" -newer "$TAURI_CONF" 2>/dev/null | head -1)
if [ -z "$APK" ]; then
  echo "ERROR: No APK found"
  exit 1
fi

SAFE_NAME=$(echo "$APP_NAME" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
OUT="$SAFE_NAME.apk"

# Find Android SDK build tools
BUILD_TOOLS=$(ls -d ~/Library/Android/sdk/build-tools/*/ 2>/dev/null | sort -V | tail -1)
ZIPALIGN="${BUILD_TOOLS}zipalign"
APKSIGNER="${BUILD_TOOLS}apksigner"

# Generate a debug keystore if one doesn't exist
DEBUG_KEYSTORE="$HOME/.android/debug.keystore"
if [ ! -f "$DEBUG_KEYSTORE" ]; then
  echo "==> Generating debug keystore..."
  mkdir -p "$HOME/.android"
  keytool -genkeypair -v -keystore "$DEBUG_KEYSTORE" \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android \
    -dname "CN=Android Debug,O=Android,C=US"
fi

echo "==> Signing APK..."
# Zipalign first (required before apksigner)
"$ZIPALIGN" -f 4 "$APK" "$OUT.aligned"
# Sign with debug key
"$APKSIGNER" sign --ks "$DEBUG_KEYSTORE" --ks-pass pass:android \
  --key-pass pass:android --ks-key-alias androiddebugkey \
  --out "$OUT" "$OUT.aligned"
rm -f "$OUT.aligned"

echo ""
echo "Done! Signed APK: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Sideload with: adb install $OUT"
