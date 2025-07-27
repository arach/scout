#!/bin/bash

# Install PostCSS and its plugins for the new CSS architecture

echo "Installing PostCSS and optimization plugins..."

pnpm add -D \
  postcss \
  postcss-import \
  postcss-nesting \
  postcss-custom-properties \
  postcss-custom-media \
  postcss-media-minmax \
  autoprefixer \
  @fullhuman/postcss-purgecss \
  cssnano

echo "✅ CSS dependencies installed successfully!"
echo ""
echo "Next steps:"
echo "1. Run 'pnpm dev' to test the new CSS architecture"
echo "2. Gradually migrate component styles to use CSS modules"
echo "3. Update imports in main.tsx to use the new styles/index.css"