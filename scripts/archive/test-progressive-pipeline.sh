#!/bin/bash

echo "Progressive Transcription Pipeline Test"
echo "======================================="
echo ""
echo "This test will:"
echo "1. Start Scout with progressive strategy"
echo "2. Monitor real-time Tiny model chunks"
echo "3. Track Medium model refinements"
echo "4. Show latency when recording stops"
echo ""

# Configuration for testing
CHUNK_SIZES=(5 10 15)
CURRENT_CHUNK=${1:-15}

echo "Testing with ${CURRENT_CHUNK}s refinement chunks"
echo ""

# Create a test config that forces progressive strategy
cat > /tmp/scout_progressive_test.json << EOF
{
  "audio": {
    "sample_rate": 16000,
    "channels": 1,
    "buffer_size": 1024,
    "vad_enabled": false,
    "silence_threshold": 0.01,
    "min_recording_duration_ms": 500
  },
  "models": {
    "active_model_id": "medium.en",
    "fallback_model_id": "tiny.en"
  },
  "processing": {
    "enable_chunking": true,
    "chunking_threshold_secs": 5,
    "chunk_duration_secs": 5,
    "refinement_chunk_secs": ${CURRENT_CHUNK},
    "force_strategy": "progressive"
  }
}
EOF

echo "Starting Scout with progressive strategy enabled..."
echo "Watch for these events:"
echo ""
echo "🚀 Strategy Selection:"
echo "   'Auto-selected progressive strategy (Tiny + Medium)'"
echo ""
echo "⚡ Real-time (Tiny):"
echo "   'Processing chunk X (5s)' - immediate feedback"
echo ""
echo "🔄 Refinements (Medium):"
echo "   'Processing refinement chunk' - quality updates every ${CURRENT_CHUNK}s"
echo ""
echo "🏁 Recording Stops:"
echo "   'Recording finalized, stopping refinement task to minimize latency'"
echo ""
echo "Press Ctrl+C to stop..."
echo ""

# Run with the test config and filter logs
RUST_LOG=scout=debug pnpm tauri dev 2>&1 | grep -E --color=always "(progressive|Progressive|strategy|Strategy|chunk|Chunk|refinement|Refinement|finalized|latency|Tiny|Medium|Created new transcriber|Reusing cached|Canceling background|Waiting for background|models/ggml)" | sed -E 's/^.*\[INFO\]/*/' | sed -E 's/^.*\[DEBUG\]/  /' | sed -E 's/^.*\[WARN\]/⚠️ /'