#!/bin/bash
# Runs Lettly entirely on this Mac: a local server with its own database file,
# and the app in your web browser. No cloud account needed.
#
#   ./run-local.sh           Start the server and open the app in your browser
#   ./run-local.sh server    Start only the server (for example, for the iPhone app)
#
# The database is the file data/lettly.db in this folder. Back it up by copying
# the data folder; delete the folder to start again from nothing.
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-web}"
PORT="${PORT:-4000}"
export npm_config_legacy_peer_deps=true

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || fail "Node.js is not installed. Install version 22 or later from https://nodejs.org, then run this again."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node.js $(node -v) is too old for the built-in database. Install the current version 22 or later from https://nodejs.org."

# The address other devices on your Wi-Fi use to reach this Mac.
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)"
URL="http://${IP}:${PORT}"

# Tell the app to use this server. Delete apps/mobile/.env to go back to demo mode.
printf 'EXPO_PUBLIC_API_URL=%s\n' "$URL" > apps/mobile/.env

start_server() { PORT="$PORT" node --experimental-strip-types --disable-warning=ExperimentalWarning apps/server/src/main.ts; }

if [ "$MODE" = "server" ]; then
  say "Starting the local server at $URL"
  start_server
  exit 0
fi

say "1/3 Starting the local server at $URL"
start_server &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || fail "The server stopped unexpectedly. Send the message above to Claude."
  sleep 0.5
done

say "2/3 Installing app packages (a few minutes the first time)..."
npm install --workspace @lettly/mobile
(cd apps/mobile && (npx expo install --fix || echo "Version check reported problems; carrying on."))

say "3/3 Opening the app in your browser. Leave this window running; press Ctrl+C to stop everything."
echo "First time: choose 'Create a landlord account'."
echo "To use the iPhone app with the same data, keep this running and, in another Terminal window, run:  bash run-on-iphone.sh"
cd apps/mobile && npx expo start --web
