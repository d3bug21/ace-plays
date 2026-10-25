import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Writes dist/sw.js after every production build. Its cache name embeds a hash
 * of the whole build, so each deploy installs a new worker and drops the old
 * cache - players are never stuck on an outdated version.
 */
function versionedServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'ace-versioned-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(p);
        }
      };
      walk(outDir);
      const rel = files.map((f) => relative(outDir, f).split(sep).join('/')).filter((f) => f !== 'sw.js').sort();
      const h = createHash('sha256');
      for (const f of rel) h.update(f).update(readFileSync(join(outDir, f)));
      const version = h.digest('hex').slice(0, 12);
      const template = readFileSync('src/sw-template.js', 'utf8');
      writeFileSync(join(outDir, 'sw.js'), template.replace('__ACE_VERSION__', version));
    },
  };
}

// Relative base so the production build runs from file:// (Electron) and any static folder.
export default defineConfig({
  base: './',
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  server: { port: Number(process.env.PORT || 5173), strictPort: false, hmr: process.env.VITE_NO_HMR ? false : undefined },
  plugins: [versionedServiceWorker()],
  build: {
    outDir: process.env.VITE_OUT_DIR || 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
});
