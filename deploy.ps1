# Copy site into dist/ for GitHub Pages (no Vite build)
# Run from project root: .\deploy.ps1

Write-Host "Syncing files to dist/..."
npm run dist

Write-Host ""
Write-Host "Done! The dist/ folder is ready to publish."
Write-Host "  - Push to GitHub (workflow deploys dist/)"
Write-Host "  - Or copy dist/* into your github-pages branch manually"
