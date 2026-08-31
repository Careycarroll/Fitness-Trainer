import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base path handling: GitHub Pages serves from /<repo>/, local dev serves from /.
// Set BASE_PATH in the deploy workflow. Mirrors the pattern used in the other web apps.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  // A visible build stamp. The reason a stale worker cost several rounds is that
  // a stale bundle looks IDENTICAL to a broken one — the same trap as the
  // `data-preview` simulator in #74. Render this somewhere small and the
  // question "am I looking at the current build?" is answered by looking.
  define: {
    __BUILD__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z'
    )
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // js/main.js imports `virtual:pwa-register` explicitly. Without this the
      // plugin injects its own registration as well, and two registrations for
      // one worker is a race worth not having.
      injectRegister: null,
      // ADR-001: app shell is cache-first. The app must open with zero network.
      workbox: {
        // webp is here and jpg is NOT, deliberately. The 300px thumbnails are
        // precached so the library works offline (ADR-001); the full-size
        // originals under the same directory are ~40 MB and load on tap only.
        globPatterns: ['**/*.{js,css,html,json,svg,png,webp,webmanifest}'],
        navigateFallback: `${base}index.html`
      },
      manifest: {
        name: 'Training Planner',
        short_name: 'Planner',
        description: 'Offline training session and mesocycle planner',
        theme_color: '#12161c',
        background_color: '#12161c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
});
