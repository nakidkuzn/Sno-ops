#!/usr/bin/env bash
set -e
echo
echo "=== Winter Ops Command Center ==="
echo

# cd to project root (this file lives in scripts/)
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install it from https://nodejs.org (LTS recommended) and rerun this script."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f .env ]; then
  echo "Creating .env from .env.example"
  cp .env.example .env
fi

# Open browser
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:5173" || true
fi

echo "Starting server..."
exec node server.js
