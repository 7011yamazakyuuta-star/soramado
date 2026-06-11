import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '空窓 soramado',
        short_name: '空窓',
        description:
          'ディスプレイを空への窓に。物理ベースの大気散乱をリアルタイム描画する空のレンダラー / Turn your display into a window to an endless, physically simulated sky.',
        lang: 'ja',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        background_color: '#03060c',
        theme_color: '#0b2a5e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Precomputed scattering LUTs (optional, large): cache on first use.
        runtimeCaching: [
          {
            urlPattern: /\/lut\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'soramado-lut',
              expiration: { maxEntries: 16 },
            },
          },
        ],
      },
    }),
  ],
});
