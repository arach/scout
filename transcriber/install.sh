#!/bin/bash
# Quick installer for transcriber

set -e

echo "🔨 Building transcriber..."
cargo build --release

echo "📦 Installing to /usr/local/bin..."
sudo ln -sf "$(pwd)/target/release/transcriber" /usr/local/bin/transcriber

echo "✅ Installation complete!"
echo ""
echo "You can now use transcriber from anywhere:"
echo "  transcriber --help"
echo "  transcriber --model whisper"
echo "  transcriber --model parakeet --use-zeromq"
echo ""
echo "To uninstall:"
echo "  sudo rm /usr/local/bin/transcriber"