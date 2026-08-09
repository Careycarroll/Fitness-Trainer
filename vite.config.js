import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base path handling: GitHub Pages serves from /<repo>/, local dev serves from /.
// Set BASE_PATH in the deploy workflow. Mirrors the pattern used in the other web apps.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // ADR-001: app shell is cache-first. The app must open with zero network.
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,svg,png,webmanifest}'],
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
