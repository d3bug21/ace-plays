import { defineConfig } from 'vite';

// Relative base so the production build runs from file:// (Electron) and any static folder.
export default defineConfig({
  base: './',
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  server: { port: Number(process.env.PORT || 5173), strictPort: false, hmr: process.env.VITE_NO_HMR ? false : undefined },
  build: {
    outDir: process.env.VITE_OUT_DIR || 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
});
