#!/usr/bin/env bash
# Shared launcher logic for Play-Mac.command and Play-Linux.sh.
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "============================================================"
  echo " Zombies From Mars needs Node.js to run, and it isn't"
  echo " installed on this computer yet."
  echo ""
  echo " 1. A download page will open in your browser."
  echo " 2. Download and run the installer (pick the \"LTS\" version)."
  echo " 3. Come back here and double-click the launcher again."
  echo "============================================================"
  echo ""
  if command -v open >/dev/null 2>&1; then open "https://nodejs.org"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "https://nodejs.org"
  fi
  read -rp "Press Enter to close this window..." _
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Setting up the game the first time you play - this takes a few seconds..."
  npm install
fi

echo ""
echo "Starting Zombies From Mars..."
echo "Your browser will open automatically. Close this window to stop the game."
echo ""
npm start
read -rp "Press Enter to close this window..." _
