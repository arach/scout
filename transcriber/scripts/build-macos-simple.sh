#!/bin/bash
# Simplified macOS bundle builder using system Python with uv embedded
# This approach embeds uv and installs dependencies on first run

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building macOS bundle for Transcriber (with embedded uv)${NC}"
echo "========================================================"

# Configuration
BUNDLE_NAME="Transcriber"
BUNDLE_DIR="dist/${BUNDLE_NAME}.app"
CONTENTS_DIR="${BUNDLE_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

# Clean previous build
echo -e "${YELLOW}Cleaning previous build...${NC}"
rm -rf dist/

# Create app bundle structure
echo -e "${YELLOW}Creating app bundle structure...${NC}"
mkdir -p "${MACOS_DIR}"
mkdir -p "${RESOURCES_DIR}"
mkdir -p "${RESOURCES_DIR}/bin"

# Build the Rust binary
echo -e "${YELLOW}Building Rust binary...${NC}"
cargo build --release
cp target/release/transcriber "${MACOS_DIR}/"

# Download and embed uv
echo -e "${YELLOW}Downloading uv for macOS...${NC}"
UV_VERSION="0.4.18"
if [[ $(uname -m) == "arm64" ]]; then
    UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz"
else
    UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz"
fi

curl -L "${UV_URL}" -o /tmp/uv.tar.gz
tar -xzf /tmp/uv.tar.gz -C "${RESOURCES_DIR}/bin" uv
chmod +x "${RESOURCES_DIR}/bin/uv"
rm /tmp/uv.tar.gz

# Copy Python scripts
echo -e "${YELLOW}Copying Python scripts...${NC}"
cp -r python/ "${RESOURCES_DIR}/"

# Create a requirements file for the Python dependencies
cat > "${RESOURCES_DIR}/requirements.txt" << 'EOF'
msgpack
numpy
pyzmq
torch
transformers
huggingface-hub
scipy
mlx
parakeet-mlx
EOF

# Create first-run setup script
cat > "${RESOURCES_DIR}/setup-dependencies.sh" << 'EOF'
#!/bin/bash
# Setup Python dependencies on first run

RESOURCES_DIR="$(dirname "$0")"
VENV_DIR="${HOME}/.transcriber/venv"
MARKER_FILE="${HOME}/.transcriber/.deps-installed"

# Check if dependencies are already installed
if [ -f "${MARKER_FILE}" ]; then
    echo "Dependencies already installed"
    exit 0
fi

echo "Setting up Python dependencies (first run only)..."
mkdir -p "${HOME}/.transcriber"

# Create virtual environment using uv
"${RESOURCES_DIR}/bin/uv" venv "${VENV_DIR}"

# Install dependencies
"${RESOURCES_DIR}/bin/uv" pip install --python "${VENV_DIR}/bin/python" \
    -r "${RESOURCES_DIR}/requirements.txt"

# Download models
echo "Downloading AI models..."
"${VENV_DIR}/bin/python" -c "
from transformers import WhisperProcessor, WhisperForConditionalGeneration
import os
os.environ['HF_HOME'] = os.path.expanduser('~/.transcriber/models')
model = WhisperForConditionalGeneration.from_pretrained('openai/whisper-base')
processor = WhisperProcessor.from_pretrained('openai/whisper-base')
print('Models downloaded successfully')
"

# Mark as complete
touch "${MARKER_FILE}"
echo "Setup complete!"
EOF
chmod +x "${RESOURCES_DIR}/setup-dependencies.sh"

# Create launcher script
echo -e "${YELLOW}Creating launcher script...${NC}"
cat > "${MACOS_DIR}/transcriber-launcher" << 'EOF'
#!/bin/bash
# Launcher script for Transcriber app bundle

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES_DIR="$(dirname "$DIR")/Resources"
VENV_DIR="${HOME}/.transcriber/venv"

# Ensure dependencies are installed
"${RESOURCES_DIR}/setup-dependencies.sh"

# Set up environment
export HF_HOME="${HOME}/.transcriber/models"
export TRANSFORMERS_CACHE="${HOME}/.transcriber/models"
export UV_PYTHON="${VENV_DIR}/bin/python"

# Create config directory if it doesn't exist
mkdir -p "${HOME}/.transcriber"
mkdir -p "${HOME}/.transcriber/logs"

# Default ports (can be overridden by command line args)
ZMQ_PUSH_PORT=${ZMQ_PUSH_PORT:-5555}
ZMQ_PULL_PORT=${ZMQ_PULL_PORT:-5556}
ZMQ_CONTROL_PORT=${ZMQ_CONTROL_PORT:-5557}

# Launch the transcriber with uv
exec "${DIR}/transcriber" \
    --python-cmd "${RESOURCES_DIR}/bin/uv" \
    --python-args "run --python ${VENV_DIR}/bin/python ${RESOURCES_DIR}/python/zmq_server_worker_no_deps.py" \
    --python-workdir "${RESOURCES_DIR}" \
    --zmq-push-endpoint "tcp://127.0.0.1:${ZMQ_PUSH_PORT}" \
    --zmq-pull-endpoint "tcp://127.0.0.1:${ZMQ_PULL_PORT}" \
    --zmq-control-endpoint "tcp://127.0.0.1:${ZMQ_CONTROL_PORT}" \
    "$@"
EOF
chmod +x "${MACOS_DIR}/transcriber-launcher"

# Create Info.plist
echo -e "${YELLOW}Creating Info.plist...${NC}"
cat > "${CONTENTS_DIR}/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>transcriber-launcher</string>
    <key>CFBundleIdentifier</key>
    <string>com.transcriber.app</string>
    <key>CFBundleName</key>
    <string>Transcriber</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# Create command-line helper script
echo -e "${YELLOW}Creating command-line helper...${NC}"
cat > "dist/transcriber" << 'EOF'
#!/bin/bash
# Command-line helper for Transcriber

APP_PATH="/Applications/Transcriber.app"
LAUNCHER="${APP_PATH}/Contents/MacOS/transcriber-launcher"

if [ ! -f "${LAUNCHER}" ]; then
    echo "Error: Transcriber not found at ${APP_PATH}"
    echo "Please run the installer first: ./install.sh"
    exit 1
fi

# Pass all arguments to the launcher
exec "${LAUNCHER}" "$@"
EOF
chmod +x "dist/transcriber"

# Create installer script
echo -e "${YELLOW}Creating installer script...${NC}"
cat > "dist/install.sh" << 'EOF'
#!/bin/bash
# Install Transcriber to /Applications

set -e

echo "Installing Transcriber..."

# Copy to Applications
if [ -d "/Applications/Transcriber.app" ]; then
    echo "Removing existing installation..."
    rm -rf "/Applications/Transcriber.app"
fi

echo "Copying to /Applications..."
cp -R "Transcriber.app" "/Applications/"

# Install command-line tool
echo "Installing command-line tool..."
sudo ln -sf "/Applications/Transcriber.app/Contents/MacOS/transcriber-launcher" /usr/local/bin/transcriber

# Create LaunchAgent for auto-start (optional)
read -p "Would you like Transcriber to start automatically at login? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p ~/Library/LaunchAgents
    cat > ~/Library/LaunchAgents/com.transcriber.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.transcriber</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Transcriber.app/Contents/MacOS/transcriber-launcher</string>
        <string>--workers</string>
        <string>2</string>
        <string>--use-zeromq</string>
        <string>true</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/Users/USER/Library/Logs/transcriber.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/USER/Library/Logs/transcriber.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>ZMQ_PUSH_PORT</key>
        <string>5555</string>
        <key>ZMQ_PULL_PORT</key>
        <string>5556</string>
        <key>ZMQ_CONTROL_PORT</key>
        <string>5557</string>
    </dict>
</dict>
</plist>
PLIST
    # Replace USER with actual username
    sed -i '' "s/USER/$USER/g" ~/Library/LaunchAgents/com.transcriber.plist
    launchctl load ~/Library/LaunchAgents/com.transcriber.plist
    echo "Auto-start configured successfully"
fi

echo ""
echo "✅ Transcriber installed successfully!"
echo ""
echo "The first run will download and set up Python dependencies (one-time setup)."
echo ""
echo "Usage:"
echo "  transcriber --help                    # Show help"
echo "  transcriber --workers 4               # Start with 4 workers"
echo "  transcriber --use-zeromq true         # Use ZeroMQ mode"
echo ""
echo "To use custom ports, set environment variables:"
echo "  export ZMQ_PUSH_PORT=6000"
echo "  export ZMQ_PULL_PORT=6001"
echo "  export ZMQ_CONTROL_PORT=6002"
echo "  transcriber --use-zeromq true"
echo ""
echo "Logs are stored in: ~/Library/Logs/"
echo ""
EOF
chmod +x "dist/install.sh"

# Bundle size estimate
echo ""
echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo ""
echo "Bundle location: ${BUNDLE_DIR}"
echo "Bundle size: ~10MB (plus ~2GB for models/dependencies on first run)"
echo ""
echo "To install:"
echo "  cd dist && ./install.sh"
echo ""
echo "Features:"
echo "  - Self-contained app bundle"
echo "  - Embedded uv package manager"
echo "  - Automatic dependency installation on first run"
echo "  - Configurable ZeroMQ ports"
echo "  - Command-line tool included"
echo "  - No prerequisites required!"