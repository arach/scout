#!/bin/bash

# Scout v0.2.0 Release Commands
# Run these to create the GitHub release

echo "🚀 Creating Scout v0.2.0 Release..."

# 1. Create git tag
git tag -a v0.2.0 -m "Release v0.2.0 - Progressive Transcription"

# 2. Push the tag
git push origin v0.2.0

# 3. Create GitHub release using gh CLI
gh release create v0.2.0 \
  --title "Scout v0.2.0 - Progressive Transcription" \
  --notes-file GITHUB_RELEASE.md \
  --draft \
  Scout-v0.2.0.dmg

echo "✅ Draft release created!"
echo "📝 Next steps:"
echo "1. Review the draft release on GitHub"
echo "2. Add any additional notes"
echo "3. Publish when ready"
echo ""
echo "🌐 Blog deployment:"
echo "1. Merge to main branch"
echo "2. GitHub Actions will deploy the blog automatically"