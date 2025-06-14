#!/bin/bash

# Download Whisper models for Scout

MODELS_DIR="models"

# Create models directory if it doesn't exist
mkdir -p "$MODELS_DIR"

# Model URLs from Hugging Face
BASE_EN_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

echo "Downloading Whisper base.en model..."
echo "This may take a few minutes depending on your internet connection..."

# Download the model
if curl -L "$BASE_EN_URL" -o "$MODELS_DIR/ggml-base.en.bin" --progress-bar; then
    echo "✓ Model downloaded successfully!"
    echo "Model saved to: $MODELS_DIR/ggml-base.en.bin"
else
    echo "✗ Failed to download model"
    exit 1
fi

# Verify the file was downloaded
if [ -f "$MODELS_DIR/ggml-base.en.bin" ]; then
    SIZE=$(du -h "$MODELS_DIR/ggml-base.en.bin" | cut -f1)
    echo "Model size: $SIZE"
else
    echo "✗ Model file not found after download"
    exit 1
fi

echo ""
echo "All done! The Whisper model is ready to use."