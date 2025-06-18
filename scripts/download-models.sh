#!/bin/bash

# Script to download a test model for development

MODEL_DIR="models"
BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

# Create models directory if it doesn't exist
mkdir -p "$MODEL_DIR"

echo "Downloading test model for development..."

# Download tiny model (39 MB) for development testing
if [ ! -f "$MODEL_DIR/ggml-tiny.en.bin" ]; then
    echo "Downloading tiny.en model (39 MB)..."
    curl -L -o "$MODEL_DIR/ggml-tiny.en.bin" "$BASE_URL/ggml-tiny.en.bin"
else
    echo "tiny.en model already exists"
fi

echo "Model download complete!"
echo ""
echo "NOTE: This model is for development only."
echo "In production, users download models from within the app."
echo "Models are stored in ~/Library/Application Support/com.scout.app/models/"

# Make models directory relative to script location
cd "$(dirname "$0")/.." || exit