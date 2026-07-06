#!/bin/bash
# Copy site into dist/ for GitHub Pages (no Vite build)
# Run: bash deploy.sh

echo "Syncing files to dist/..."
npm run dist

echo ""
echo "Done! The dist/ folder is ready to publish."
