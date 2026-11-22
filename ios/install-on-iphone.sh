#!/bin/zsh
# Builds LukeOS and puts it on Luke's iPhone. Run it from anywhere:
#   ~/Developer/lukeos/ios/install-on-iphone.sh
# The iPhone must be unlocked and on the same Wi-Fi as this Mac (or plugged in).
set -e
cd "$(dirname "$0")"
DEVICE=${DEVICE:-546DBE0A-2198-5194-A996-07E4109DF0E4}
echo "Updating the code…"
git pull --quiet --no-rebase || echo "(couldn't pull; building what's here)"
command -v xcodegen >/dev/null && xcodegen generate --quiet
echo "Building (a few minutes the first time)…"
xcodebuild -project LukeOS.xcodeproj -scheme LukeOS -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath ~/Developer/DerivedData \
  -allowProvisioningUpdates -quiet build
echo "Installing on the iPhone…"
xcrun devicectl device install app --device "$DEVICE" ~/Developer/DerivedData/Build/Products/Release-iphoneos/LukeOS.app
xcrun devicectl device process launch --device "$DEVICE" com.lewisdesign.lukeos >/dev/null 2>&1 || true
echo "Done. LukeOS is on your iPhone."
