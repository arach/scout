#!/bin/bash

# Dev script that allows running multiple Tauri instances on different ports
# Usage: ./scripts/dev.sh [port]
# Example: ./scripts/dev.sh 1425

PORT=${1:-5173}
HMR_PORT=$((PORT + 1))

echo "Starting Scout dev server on port $PORT (HMR: $HMR_PORT)"

# Export environment variables for Vite
export VITE_PORT=$PORT
export VITE_HMR_PORT=$HMR_PORT

# Create a temporary Tauri config with the correct port
TEMP_CONFIG=$(mktemp)
cat src-tauri/tauri.conf.json | sed "s|\"devUrl\": \"http://localhost:[0-9]*\"|\"devUrl\": \"http://localhost:$PORT\"|" > "$TEMP_CONFIG"

# Move the temp config to the correct location
mv "$TEMP_CONFIG" src-tauri/tauri.conf.json.tmp

# Run Tauri with the temporary config
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.backup
mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# Trap to restore original config on exit
trap 'mv src-tauri/tauri.conf.json.backup src-tauri/tauri.conf.json 2>/dev/null' EXIT

# Run Tauri dev
pnpm tauri dev