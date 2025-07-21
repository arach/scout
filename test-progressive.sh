#!/bin/bash

echo "Testing Progressive Transcription Strategy"
echo "========================================="

# Force progressive strategy
export SCOUT_TRANSCRIPTION_STRATEGY=progressive

# Run the app with debug logging
RUST_LOG=scout=debug VITE_PORT=1421 pnpm tauri dev 2>&1 | grep -E "strategy|Strategy|progressive|Progressive|Tiny|Medium|refinement|refined"