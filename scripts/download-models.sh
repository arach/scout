#!/bin/bash

# Script to download Whisper models for Scout

MODEL_DIR="models"
BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

# Create models directory if it doesn't exist
mkdir -p "$MODEL_DIR"

echo "Downloading Whisper models..."

# Download tiny model (39 MB) - fastest, lowest quality
if [ ! -f "$MODEL_DIR/ggml-tiny.en.bin" ]; then
    echo "Downloading tiny.en model..."
    curl -L -o "$MODEL_DIR/ggml-tiny.en.bin" "$BASE_URL/ggml-tiny.en.bin"
else
    echo "tiny.en model already exists"
fi

# Download base model (142 MB) - good balance
if [ ! -f "$MODEL_DIR/ggml-base.en.bin" ]; then
    echo "Downloading base.en model..."
    curl -L -o "$MODEL_DIR/ggml-base.en.bin" "$BASE_URL/ggml-base.en.bin"
else
    echo "base.en model already exists"
fi

# Download small model (466 MB) - better quality
# Uncomment if you want the small model
# if [ ! -f "$MODEL_DIR/ggml-small.en.bin" ]; then
#     echo "Downloading small.en model..."
#     curl -L -o "$MODEL_DIR/ggml-small.en.bin" "$BASE_URL/ggml-small.en.bin"
# else
#     echo "small.en model already exists"
# fi

echo "Model download complete!"
echo "Models are stored in: $MODEL_DIR/"

# Make models directory relative to script location
cd "$(dirname "$0")/.." || exit