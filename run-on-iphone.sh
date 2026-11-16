#!/bin/bash
# Puts the Lettly app on your iPhone in demo mode (sample data, no backend needed).
#
#   ./run-on-iphone.sh            Build the app with Xcode and install it on the iPhone
#                                 plugged into this Mac. The app then works on its own.
#   ./run-on-iphone.sh expo-go    No Xcode: run the app inside the Expo Go app by
#                                 scanning a QR code (phone and Mac on the same Wi-Fi).
#   ./run-on-iphone.sh web        Open the same app in your web browser on this Mac.
#
# Optional: EXPO_SDK=58 ./run-on-iphone.sh ...   to force an Expo SDK version.
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-install}"
# Expo packages often declare peer versions that npm treats as conflicts; this stops npm refusing to install.
export npm_config_legacy_peer_deps=true

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || fail "Node.js is not installed. Install it from https://nodejs.org (version 22 or later), then run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $NODE_MAJOR is too old. Install version 22 or later from https://nodejs.org."

SDK="${EXPO_SDK:-54}"
if [ "$MODE" = "install" ]; then
  xcodebuild -version >/dev/null 2>&1 || fail "Xcode is not installed (or not set up). Install Xcode from the Mac App Store, open it once, then run this again.
Or skip Xcode and use Expo Go:  ./run-on-iphone.sh expo-go"
  XCODE_MAJOR="$(xcodebuild -version | awk 'NR==1 {split($2, v, "."); print v[1]}')"
  # Expo SDK 58 is the first built for Xcode 27; SDK 54 covers Xcode 16.1 to 26.
  if [ -z "${EXPO_SDK:-}" ] && [ "$XCODE_MAJOR" -ge 27 ]; then SDK=58; fi
  say "Xcode $XCODE_MAJOR found. Using Expo SDK $SDK."
fi

say "1/3 Installing packages (a few minutes the first time)..."
npm install --workspace @lettly/mobile

# The app must load exactly one copy of React. Two copies (one at the top level, one
# inside apps/mobile) make the installed app close as soon as it opens.
react_copies() { find node_modules apps/mobile/node_modules -maxdepth 2 -name package.json -path '*/react/package.json' 2>/dev/null | wc -l | tr -d ' '; }
if [ "$(react_copies)" != "1" ]; then
  say "Found more than one copy of React. Reinstalling packages cleanly..."
  rm -rf node_modules apps/mobile/node_modules package-lock.json
  npm install --workspace @lettly/mobile
  [ "$(react_copies)" = "1" ] || fail "There is still more than one copy of React installed. Send this message to Claude."
fi

cd apps/mobile
say "2/3 Matching package versions to Expo SDK $SDK..."
if [ "$SDK" != "54" ]; then
  npx expo install "expo@^${SDK}.0.0" --fix
else
  npx expo install --fix || echo "Version check reported problems; carrying on."
fi

if [ "$MODE" = "web" ]; then
  say "3/3 Starting. The app opens in your browser; leave this window running."
  exec npx expo start --web
fi

if [ "$MODE" = "expo-go" ]; then
  say "3/3 Starting. Open the Camera on your iPhone and scan the QR code below."
  echo "It opens in the Expo Go app (install it from the App Store first)."
  echo "If Expo Go says the project is incompatible, stop this (Ctrl+C) and run:"
  echo "  EXPO_SDK=58 ./run-on-iphone.sh expo-go"
  exec npx expo start
fi

say "3/3 Building and installing on your iPhone (10 to 20 minutes the first time)..."
echo "Before this step: plug the iPhone in with a cable, unlock it and tap Trust."
echo "If asked for a signing team, choose your Apple ID (add it in Xcode > Settings > Accounts)."
# Find the plugged-in iPhone or iPad. Real devices are listed with an iOS version, e.g.
#   iPhone (26.5.2) (00008130-0002319C3420001C)
DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null | sed '/== Simulators ==/,$d' \
  | sed -nE 's/^.+ \([0-9]+\.[0-9.]+\) \(([0-9A-Fa-f-]+)\)$/\1/p' | head -n 1)"
[ -n "$DEVICE_ID" ] || fail "No iPhone found. Plug it in with a cable, unlock it, tap Trust, turn on
Settings > Privacy & Security > Developer Mode, then run this again."

# Xcode cannot build for iPhone until its iOS platform files are downloaded.
if ! xcodebuild -showsdks 2>/dev/null | grep -q iphoneos || ! xcrun simctl list runtimes 2>/dev/null | grep -q iOS; then
  say "Downloading Xcode's iOS platform files (several GB, one time only)..."
  xcodebuild -downloadPlatform iOS || echo "Could not download automatically. In Xcode open Settings > Components and get iOS, then run this again."
fi

echo "Installing to device $DEVICE_ID"
exec npx expo run:ios --device "$DEVICE_ID" --configuration Release
