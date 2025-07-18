#!/bin/bash

# Script to download CoreML models for faster performance on macOS

MODELS_DIR="$HOME/Library/Application Support/com.scout.app/models"

# Create models directory if it doesn't exist
mkdir -p "$MODELS_DIR"

echo "Downloading CoreML models for faster performance on macOS..."
echo "Models will be saved to: $MODELS_DIR"
echo ""

# Function to download and extract CoreML model
download_coreml_model() {
    local model_name=$1
    local url=$2
    local zip_file="${model_name}.zip"
    local model_dir="${model_name%.zip}"
    
    if [ -d "$MODELS_DIR/$model_dir" ]; then
        echo "✓ $model_dir already exists"
        return
    fi
    
    echo "Downloading $model_name (this may take a while)..."
    if curl -L --progress-bar -o "$MODELS_DIR/$zip_file" "$url"; then
        echo "Extracting $zip_file..."
        cd "$MODELS_DIR" || exit
        unzip -q "$zip_file"
        rm "$zip_file"
        echo "✓ $model_name downloaded and extracted"
    else
        echo "✗ Failed to download $model_name"
    fi
}

# Direct download URLs for CoreML models (using git-lfs URLs)
echo "Note: These are large files. Download may take several minutes depending on your connection."
echo ""

# Medium English model (234 MB) - most commonly used
download_coreml_model "ggml-medium.en-encoder.mlmodelc" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-encoder.mlmodelc.zip?download=true"

# Base English model (38 MB) - good balance of speed and accuracy
download_coreml_model "ggml-base.en-encoder.mlmodelc" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-encoder.mlmodelc.zip?download=true"

# Small English model (155 MB) - between base and medium
download_coreml_model "ggml-small.en-encoder.mlmodelc" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-encoder.mlmodelc.zip?download=true"

# Tiny English model (15 MB) - fastest but least accurate
download_coreml_model "ggml-tiny.en-encoder.mlmodelc" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-encoder.mlmodelc.zip?download=true"

echo ""
echo "CoreML model download complete!"
echo ""
echo "These models enable hardware acceleration on Apple Silicon Macs."
echo "You should see significant performance improvements when using Whisper."
echo ""
echo "Note: Make sure you have the corresponding .bin model files as well."