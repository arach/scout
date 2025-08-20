#!/bin/bash
# Test the installer locally

echo "Testing Scout Transcriber installer..."
echo ""
echo "This will simulate what users will run:"
echo "  curl -sSf https://scout.arach.dev/install.sh | bash"
echo ""
echo "For now, testing with local file:"
echo ""

# Run the local installer in dry-run mode
bash /Users/arach/dev/scout/landing/public/install.sh

echo ""
echo "Once deployed to GitHub Pages, users can install with:"
echo "  curl -sSf https://scout.arach.dev/install.sh | bash"