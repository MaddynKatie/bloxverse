# BloxVerse

A Roblox-style web game built with Three.js

## Deployment

This folder contains the built files ready for GitHub Pages hosting.

### Manual Deployment:
1. Copy all files from this folder to your repository's root
2. Enable GitHub Pages in your repo settings (Settings → Pages → Source: Deploy from a branch → Branch: main / root)
3. Your site will be live at: `https://yourusername.github.io/BloxVerse/`

### Automated Deployment:
Use the GitHub Actions workflow in `.github/workflows/deploy.yml` (create this in your main branch):

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## File Structure:
- `index.html` - Main page
- `game.html` - Game page  
- `search.html` - Player search
- `auth.html` - Login/Signup
- `profile.html` - User profiles
- `assets/` - Game assets and built JS/CSS
