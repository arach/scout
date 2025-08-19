#!/bin/bash
# Scout Transcriber Quick Start Script

set -e

echo "🚀 Scout Transcriber Quick Start"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for required tools
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed${NC}"
        echo "   Please install $1 first:"
        echo "   $2"
        exit 1
    else
        echo -e "${GREEN}✓ $1 is installed${NC}"
    fi
}

echo -e "\n${YELLOW}Checking prerequisites...${NC}"
check_command "cargo" "Visit https://rustup.rs"
check_command "uv" "Run: curl -LsSf https://astral.sh/uv/install.sh | sh"

# Build the Rust service
echo -e "\n${YELLOW}Building Scout Transcriber...${NC}"
if cargo build --release; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# Test Python worker
echo -e "\n${YELLOW}Testing Python worker...${NC}"
if uv run python/transcriber.py --help &> /dev/null; then
    echo -e "${GREEN}✓ Python worker is ready${NC}"
else
    echo -e "${RED}❌ Python worker test failed${NC}"
    echo "   Trying to fix by installing dependencies..."
    uv pip install msgpack numpy torch transformers huggingface-hub
fi

# Create queue directories
echo -e "\n${YELLOW}Setting up queue directories...${NC}"
mkdir -p /tmp/scout-transcriber/{input,output}
echo -e "${GREEN}✓ Queue directories created${NC}"

# Start options
echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo -e "\n${YELLOW}Start the service with:${NC}"
echo ""
echo "  # Basic (2 workers, default settings):"
echo "  ./target/release/scout-transcriber"
echo ""
echo "  # Production (4 workers, info logging):"
echo "  ./target/release/scout-transcriber --workers 4 --log-level info"
echo ""
echo "  # Development (debug logging, 1 worker):"
echo "  ./target/release/scout-transcriber --workers 1 --log-level debug"
echo ""
echo "  # Custom Python model:"
echo "  ./target/release/scout-transcriber --python-args \"run python/transcriber.py --model parakeet\""
echo ""

# Offer to start the service
echo -e "${YELLOW}Would you like to start the service now? (y/n)${NC}"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    echo -e "\n${GREEN}Starting Scout Transcriber...${NC}"
    echo "Press Ctrl+C to stop"
    echo ""
    ./target/release/scout-transcriber --log-level info
else
    echo -e "\n${GREEN}You can start the service later with:${NC}"
    echo "  ./target/release/scout-transcriber"
fi