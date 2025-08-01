#!/bin/bash

echo "Quick Progressive Strategy Test"
echo "==============================="
echo ""
echo "This will help you test different refinement chunk sizes"
echo ""

# Default to 15 seconds if not specified
CHUNK_SIZE=${1:-15}

echo "Testing with ${CHUNK_SIZE}-second refinement chunks"
echo ""

# Create a temporary config override
cat > /tmp/scout_test_config.json << EOF
{
  "transcription": {
    "enable_chunking": true,
    "chunking_threshold_secs": 5,
    "refinement_chunk_secs": ${CHUNK_SIZE},
    "force_strategy": "progressive"
  }
}
EOF

echo "Starting Scout with progressive strategy..."
echo "- Tiny model: Real-time feedback (5-second chunks)"
echo "- Medium model: Background refinement (${CHUNK_SIZE}-second chunks)"
echo ""
echo "Watch for these log messages:"
echo "  🚀 'Auto-selected progressive strategy (Tiny + Medium)'"
echo "  🔄 'Starting background refinement task (${CHUNK_SIZE}-second chunks)'"
echo "  ⏱️  'Recording finalized, stopping refinement task to minimize latency'"
echo ""
echo "Press Ctrl+C to stop..."
echo ""

# Run with debug logging and filter for relevant messages
RUST_LOG=scout=debug SCOUT_CONFIG_OVERRIDE=/tmp/scout_test_config.json pnpm tauri dev 2>&1 | grep -E --color=always "progressive|Progressive|Tiny|Medium|refinement|refined|Chunking|chunk|finalized|latency|Auto-selected|Background refinement|Processing refinement chunk|Refined chunk transcription"