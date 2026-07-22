#!/usr/bin/env bash
# island-settings.sh
#
# The island's 13 geometry/appearance settings are APP-WIDE, not per-notification
# payload fields - senders cannot set them. They live in a plain JSON file in the
# app config dir and are read when the island window is created. The in-app
# "Island" settings panel edits them LIVE (via a Tauri IPC command, not HTTP, so
# there is nothing to curl); editing the file directly is the scriptable path and
# takes effect on the next app start.
#
# On macOS the file is:
#   ~/Library/Application Support/dev.syncfu.app/island.settings.json
# The on-disk shape wraps the 13 keys in an { "island": { ... } } envelope.
# Out-of-range numbers are clamped on load, not rejected; a missing or corrupt
# file falls back to the built-in defaults.
#
# This script writes a float-mode, bottom-center, light-appearance config, then
# reminds you to restart. It does NOT restart the app for you.

set -euo pipefail

SETTINGS="$HOME/Library/Application Support/dev.syncfu.app/island.settings.json"

# Back up the current file if present.
if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak"
  echo "Backed up existing settings to $SETTINGS.bak"
fi

mkdir -p "$(dirname "$SETTINGS")"
cat > "$SETTINGS" <<'JSON'
{
  "island": {
    "compactWidth": 260,
    "expandedWidth": 420,
    "height": 38,
    "surfaceOpacity": 0.9,
    "topRadius": 12,
    "bottomRadius": 20,
    "cornerScaling": true,
    "accent": "#22c55e",
    "mode": "float",
    "position": "bottom-center",
    "appearance": "light",
    "reducedMotion": false,
    "hideFromScreenCapture": true
  }
}
JSON

echo "Wrote new island settings to:"
echo "  $SETTINGS"
echo
echo "Restart the syncfu app for the change to take effect (quit from the system"
echo "tray and relaunch). For LIVE changes without a restart, use the in-app"
echo "Island settings panel instead."
