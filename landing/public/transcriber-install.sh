#!/bin/bash
# Scout Transcriber Service Installer
# Usage: curl -sSf https://scout.arach.dev/transcriber-install.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TRANSCRIBER_VERSION="latest"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="${HOME}/.scout-transcriber"
GITHUB_REPO="arach/scout"

echo -e "${BLUE}Scout Transcriber Service Installer${NC}"
echo "===================================="
echo ""

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Darwin" ]; then
    echo -e "${RED}Error: This installer only supports macOS${NC}"
    echo "Detected OS: $OS"
    exit 1
fi

# Map architecture names
case "$ARCH" in
    x86_64)
        ARCH_NAME="x86_64"
        ;;
    arm64|aarch64)
        ARCH_NAME="aarch64"
        ;;
    *)
        echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
        exit 1
        ;;
esac

echo -e "${GREEN}✓${NC} Detected: macOS ($ARCH_NAME)"

# Check for required commands
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is required but not installed${NC}"
        echo "Please install $1 and try again"
        exit 1
    fi
}

check_command curl
check_command tar

# Create config directory
echo -e "${YELLOW}Creating configuration directory...${NC}"
mkdir -p "${CONFIG_DIR}"
mkdir -p "${CONFIG_DIR}/logs"
mkdir -p "${CONFIG_DIR}/models"

# Download the transcriber binary and resources
echo -e "${YELLOW}Downloading transcriber service...${NC}"

# Determine download URL based on version
if [ "$TRANSCRIBER_VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/transcriber-macos-${ARCH_NAME}.tar.gz"
else
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${TRANSCRIBER_VERSION}/transcriber-macos-${ARCH_NAME}.tar.gz"
fi

# Create temporary directory for download
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download and extract
echo "Downloading from: ${DOWNLOAD_URL}"
if ! curl -L --fail --progress-bar "${DOWNLOAD_URL}" -o "${TEMP_DIR}/transcriber.tar.gz"; then
    echo -e "${RED}Error: Failed to download transcriber${NC}"
    echo "Please check your internet connection and try again"
    exit 1
fi

echo -e "${YELLOW}Extracting files...${NC}"
tar -xzf "${TEMP_DIR}/transcriber.tar.gz" -C "${TEMP_DIR}"

# Install the binary
echo -e "${YELLOW}Installing transcriber...${NC}"
if [ -w "$INSTALL_DIR" ]; then
    # Directory is writable
    cp "${TEMP_DIR}/transcriber" "${INSTALL_DIR}/"
    chmod +x "${INSTALL_DIR}/transcriber"
else
    # Need sudo for system directories
    echo "Administrator access required to install to ${INSTALL_DIR}"
    sudo cp "${TEMP_DIR}/transcriber" "${INSTALL_DIR}/"
    sudo chmod +x "${INSTALL_DIR}/transcriber"
fi

# Copy Python scripts and resources
echo -e "${YELLOW}Installing Python components...${NC}"
cp -r "${TEMP_DIR}/python" "${CONFIG_DIR}/"
cp -r "${TEMP_DIR}/resources" "${CONFIG_DIR}/" 2>/dev/null || true

# Download and install uv if not already present
if [ ! -f "${CONFIG_DIR}/bin/uv" ]; then
    echo -e "${YELLOW}Installing uv package manager...${NC}"
    mkdir -p "${CONFIG_DIR}/bin"
    
    UV_VERSION="0.4.18"
    if [[ "$ARCH_NAME" == "aarch64" ]]; then
        UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz"
    else
        UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz"
    fi
    
    curl -L "${UV_URL}" -o "${TEMP_DIR}/uv.tar.gz"
    tar -xzf "${TEMP_DIR}/uv.tar.gz" -C "${CONFIG_DIR}/bin" uv
    chmod +x "${CONFIG_DIR}/bin/uv"
fi

# Create wrapper script for easier invocation
cat > "${INSTALL_DIR}/scout-transcriber" << 'EOF'
#!/bin/bash
# Scout Transcriber Service wrapper

CONFIG_DIR="${HOME}/.scout-transcriber"
VENV_DIR="${CONFIG_DIR}/venv"
UV_BIN="${CONFIG_DIR}/bin/uv"

# Ensure Python environment is set up
if [ ! -d "${VENV_DIR}" ]; then
    echo "Setting up Python environment (first run)..."
    "${UV_BIN}" venv "${VENV_DIR}"
    "${UV_BIN}" pip install --python "${VENV_DIR}/bin/python" \
        msgpack numpy pyzmq torch transformers huggingface-hub scipy
    
    # Download whisper-tiny model by default
    echo "Downloading Whisper tiny model..."
    "${VENV_DIR}/bin/python" -c "
from transformers import WhisperProcessor, WhisperForConditionalGeneration
import os
os.environ['HF_HOME'] = '${CONFIG_DIR}/models'
model = WhisperForConditionalGeneration.from_pretrained('openai/whisper-tiny')
processor = WhisperProcessor.from_pretrained('openai/whisper-tiny')
print('Model downloaded successfully')
"
fi

# Default ports (can be overridden by environment variables)
ZMQ_PUSH_PORT=${ZMQ_PUSH_PORT:-5555}
ZMQ_PULL_PORT=${ZMQ_PULL_PORT:-5556}
ZMQ_CONTROL_PORT=${ZMQ_CONTROL_PORT:-5557}

# Run the transcriber service
exec transcriber \
    --use-zeromq true \
    --python-cmd "${UV_BIN}" \
    --python-args "run --python ${VENV_DIR}/bin/python ${CONFIG_DIR}/python/zmq_server_worker_no_deps.py" \
    --python-workdir "${CONFIG_DIR}" \
    --zmq-push-endpoint "tcp://127.0.0.1:${ZMQ_PUSH_PORT}" \
    --zmq-pull-endpoint "tcp://127.0.0.1:${ZMQ_PULL_PORT}" \
    --zmq-control-endpoint "tcp://127.0.0.1:${ZMQ_CONTROL_PORT}" \
    "$@"
EOF
chmod +x "${INSTALL_DIR}/scout-transcriber"

# Create LaunchAgent for auto-start (optional)
echo ""
read -p "Would you like the transcriber service to start automatically at login? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    PLIST_PATH="${HOME}/Library/LaunchAgents/com.scout.transcriber.plist"
    mkdir -p "${HOME}/Library/LaunchAgents"
    
    cat > "${PLIST_PATH}" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.scout.transcriber</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/scout-transcriber</string>
        <string>--workers</string>
        <string>2</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${CONFIG_DIR}/logs/transcriber.log</string>
    <key>StandardErrorPath</key>
    <string>${CONFIG_DIR}/logs/transcriber.error.log</string>
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
EOF
    
    launchctl load "${PLIST_PATH}"
    echo -e "${GREEN}✓${NC} Auto-start configured"
fi

# Test the installation
echo ""
echo -e "${YELLOW}Testing installation...${NC}"
if scout-transcriber --version &>/dev/null; then
    echo -e "${GREEN}✓${NC} Transcriber installed successfully!"
else
    echo -e "${RED}✗${NC} Installation test failed"
    echo "Please check the error messages above"
    exit 1
fi

# Show next steps
echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "The Scout Transcriber Service has been installed to:"
echo "  Binary: ${INSTALL_DIR}/scout-transcriber"
echo "  Config: ${CONFIG_DIR}"
echo ""
echo "Usage:"
echo "  scout-transcriber              # Start the service"
echo "  scout-transcriber --workers 4  # Start with 4 workers"
echo "  scout-transcriber --help       # Show all options"
echo ""
echo "To use with Scout app:"
echo "  1. Open Scout → Settings → Transcription"
echo "  2. Select 'External Service' mode"
echo "  3. Click 'Test Connection'"
echo ""
echo "Default ports:"
echo "  Audio Input:  5555"
echo "  Transcripts:  5556"
echo "  Control:      5557"
echo ""
echo "To change ports, set environment variables:"
echo "  export ZMQ_PUSH_PORT=6000"
echo "  export ZMQ_PULL_PORT=6001"
echo "  export ZMQ_CONTROL_PORT=6002"
echo ""
echo "Logs are stored in: ${CONFIG_DIR}/logs/"
echo ""
echo "To uninstall, run:"
echo "  curl -sSf https://scout.arach.dev/transcriber-uninstall.sh | bash"