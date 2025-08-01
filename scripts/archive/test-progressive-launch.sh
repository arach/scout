#!/bin/bash

echo "Testing Progressive Strategy Launch"
echo "=================================="
echo ""
echo "1. Starting dev server with progressive strategy debug logging..."
echo "2. Watch for these key messages:"
echo "   - 'Chunking enabled, attempting to create progressive strategy'"
echo "   - 'Loading Tiny model from:'"
echo "   - 'Loading Medium model from:'"
echo "   - 'Auto-selected progressive strategy (Tiny + Medium)'"
echo ""
echo "Press Ctrl+C to stop..."
echo ""

# Run with debug logging
RUST_LOG=scout=debug pnpm tauri dev 2>&1 | grep -E "strategy|Strategy|progressive|Progressive|Tiny|Medium|refinement|refined|Chunking|Loading.*model|Auto-selected|Creating new transcriber|Reusing cached|Cached transcriber"