import { defineConfig } from 'vite';

export default defineConfig({
  base: '/bloxverse/',
  build: {
    outDir: 'github-pages',
    rollupOptions: {
      input: {
        main: 'index.html',
        search: 'search.html',
        game: 'game.html',
        auth: 'auth.html',
        profile: 'profile.html',
      }
    }
  }
});
