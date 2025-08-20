#!/bin/bash
# Build a self-contained macOS bundle for the transcriber service
# This creates an app bundle with embedded Python runtime and all dependencies

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building self-contained macOS bundle for Transcriber${NC}"
echo "====================================================="

# Configuration
BUNDLE_NAME="Transcriber"
BUNDLE_DIR="dist/${BUNDLE_NAME}.app"
CONTENTS_DIR="${BUNDLE_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
FRAMEWORKS_DIR="${CONTENTS_DIR}/Frameworks"
PYTHON_VERSION="3.11"

# Clean previous build
echo -e "${YELLOW}Cleaning previous build...${NC}"
rm -rf dist/

# Create app bundle structure
echo -e "${YELLOW}Creating app bundle structure...${NC}"
mkdir -p "${MACOS_DIR}"
mkdir -p "${RESOURCES_DIR}"
mkdir -p "${FRAMEWORKS_DIR}"

# Build the Rust binary
echo -e "${YELLOW}Building Rust binary...${NC}"
cargo build --release
cp target/release/transcriber "${MACOS_DIR}/"

# Create a standalone Python environment using python-build-standalone
echo -e "${YELLOW}Downloading standalone Python...${NC}"
PYTHON_STANDALONE_URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-aarch64-apple-darwin-install_only.tar.gz"

# Download and extract Python
cd "${FRAMEWORKS_DIR}"
curl -L "${PYTHON_STANDALONE_URL}" -o python.tar.gz
tar -xzf python.tar.gz
rm python.tar.gz
cd -

# Set up paths for the embedded Python
PYTHON_HOME="${FRAMEWORKS_DIR}/python"
PYTHON_BIN="${PYTHON_HOME}/bin/python3"
PIP_BIN="${PYTHON_HOME}/bin/pip3"

# Install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"
"${PIP_BIN}" install --no-cache-dir \
    msgpack \
    numpy \
    pyzmq \
    torch \
    transformers \
    huggingface-hub \
    scipy \
    mlx \
    parakeet-mlx

# Copy Python scripts
echo -e "${YELLOW}Copying Python scripts...${NC}"
cp -r python/ "${RESOURCES_DIR}/"

# Download Whisper models
echo -e "${YELLOW}Downloading Whisper models...${NC}"
mkdir -p "${RESOURCES_DIR}/models"
"${PYTHON_BIN}" -c "
from transformers import WhisperProcessor, WhisperForConditionalGeneration
import os
cache_dir = '${RESOURCES_DIR}/models'
model = WhisperForConditionalGeneration.from_pretrained('openai/whisper-base', cache_dir=cache_dir)
processor = WhisperProcessor.from_pretrained('openai/whisper-base', cache_dir=cache_dir)
print('Whisper model downloaded successfully')
"

# Create launcher script
echo -e "${YELLOW}Creating launcher script...${NC}"
cat > "${MACOS_DIR}/transcriber-launcher" << 'EOF'
#!/bin/bash
# Launcher script for Transcriber app bundle

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BUNDLE_ROOT="$(dirname "$(dirname "$DIR")")"

# Set up environment
export PYTHONHOME="${BUNDLE_ROOT}/Contents/Frameworks/python"
export PYTHONPATH="${BUNDLE_ROOT}/Contents/Resources/python:${PYTHONPATH}"
export HF_HOME="${HOME}/.transcriber/models"
export TRANSFORMERS_CACHE="${HOME}/.transcriber/models"

# Create config directory if it doesn't exist
mkdir -p "${HOME}/.transcriber"

# Default ports (can be overridden by command line args)
ZMQ_PUSH_PORT=${ZMQ_PUSH_PORT:-5555}
ZMQ_PULL_PORT=${ZMQ_PULL_PORT:-5556}
ZMQ_CONTROL_PORT=${ZMQ_CONTROL_PORT:-5557}

# Launch the transcriber with bundled Python in ZeroMQ mode
exec "${DIR}/transcriber" \
    --use-zeromq true \
    --python-cmd "${PYTHONHOME}/bin/python3" \
    --python-args "${BUNDLE_ROOT}/Contents/Resources/python/zmq_server_worker_no_deps.py" \
    --python-workdir "${BUNDLE_ROOT}/Contents/Resources" \
    --zmq-push-endpoint "tcp://127.0.0.1:${ZMQ_PUSH_PORT}" \
    --zmq-pull-endpoint "tcp://127.0.0.1:${ZMQ_PULL_PORT}" \
    --zmq-control-endpoint "tcp://127.0.0.1:${ZMQ_CONTROL_PORT}" \
    "$@"
EOF
chmod +x "${MACOS_DIR}/transcriber-launcher"

# Create Info.plist
echo -e "${YELLOW}Creating Info.plist...${NC}"
cat > "${CONTENTS_DIR}/Info.plist" << EOF
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

# Create an installer script for the user
echo -e "${YELLOW}Creating installer script...${NC}"
cat > "dist/install.sh" << 'EOF'
#!/bin/bash
# Install Transcriber to /Applications

set -e

echo "Installing Transcriber..."

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "Please do not run this installer as root/sudo"
   exit 1
fi

# Copy to Applications
if [ -d "/Applications/Transcriber.app" ]; then
    echo "Removing existing installation..."
    rm -rf "/Applications/Transcriber.app"
fi

echo "Copying to /Applications..."
cp -R "Transcriber.app" "/Applications/"

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
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/transcriber.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/transcriber.error.log</string>
</dict>
</plist>
PLIST
    launchctl load ~/Library/LaunchAgents/com.transcriber.plist
    echo "Auto-start configured successfully"
fi

echo ""
echo "✅ Transcriber installed successfully!"
echo ""
echo "To start manually:"
echo "  /Applications/Transcriber.app/Contents/MacOS/transcriber-launcher"
echo ""
echo "To check logs:"
echo "  tail -f /tmp/transcriber.log"
echo ""
EOF
chmod +x "dist/install.sh"

# Create uninstaller
echo -e "${YELLOW}Creating uninstaller script...${NC}"
cat > "dist/uninstall.sh" << 'EOF'
#!/bin/bash
# Uninstall Transcriber

echo "Uninstalling Transcriber..."

# Stop and remove LaunchAgent if it exists
if [ -f ~/Library/LaunchAgents/com.transcriber.plist ]; then
    launchctl unload ~/Library/LaunchAgents/com.transcriber.plist 2>/dev/null || true
    rm ~/Library/LaunchAgents/com.transcriber.plist
    echo "Removed auto-start configuration"
fi

# Remove app bundle
if [ -d "/Applications/Transcriber.app" ]; then
    rm -rf "/Applications/Transcriber.app"
    echo "Removed application"
fi

# Optionally remove user data
read -p "Remove user data and models? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf ~/.transcriber
    echo "Removed user data"
fi

echo "✅ Transcriber uninstalled successfully!"
EOF
chmod +x "dist/uninstall.sh"

# Create DMG for distribution
echo -e "${YELLOW}Creating DMG for distribution...${NC}"
if command -v create-dmg &> /dev/null; then
    create-dmg \
        --volname "Transcriber Installer" \
        --window-pos 200 120 \
        --window-size 600 400 \
        --icon-size 100 \
        --icon "Transcriber.app" 150 185 \
        --hide-extension "Transcriber.app" \
        --app-drop-link 450 185 \
        --no-internet-enable \
        "dist/Transcriber.dmg" \
        "dist/"
    echo -e "${GREEN}✅ DMG created: dist/Transcriber.dmg${NC}"
else
    echo -e "${YELLOW}Note: Install create-dmg for DMG creation: brew install create-dmg${NC}"
fi

# Calculate bundle size
BUNDLE_SIZE=$(du -sh "${BUNDLE_DIR}" | cut -f1)

echo ""
echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo ""
echo "Bundle location: ${BUNDLE_DIR}"
echo "Bundle size: ${BUNDLE_SIZE}"
echo ""
echo "To install:"
echo "  cd dist && ./install.sh"
echo ""
echo "The bundle includes:"
echo "  - Transcriber binary"
echo "  - Embedded Python ${PYTHON_VERSION} runtime"
echo "  - All Python dependencies"
echo "  - Whisper base model"
echo "  - Auto-start configuration (optional)"
echo ""
echo "No prerequisites required on target machine!"