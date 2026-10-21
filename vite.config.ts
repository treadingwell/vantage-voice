import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'meta/favicon.png',
        'meta/apple-touch-icon.png',
        'meta/icon-192.png',
        'meta/icon-512.png',
        'ui/vantage.webp',
        'data/stories.json',
        'figs/*.webp'
      ],
      manifest: {
        name: 'Vantage Voice',
        short_name: 'Vantage Voice',
        description: '100% Offline Voice & Storybook Companion App for Vantage by Stonemaier Games',
        theme_color: '#182432',
        background_color: '#0f1722',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          {
            src: 'meta/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'meta/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'meta/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024, // 60 MB to accommodate stories.json and offline voice models
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json,wasm,tar,gz}'],
        runtimeCaching: [
          {
            urlPattern: /\/data\/stories\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vantage-stories-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\/figs\/.*\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vantage-figs-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\/models\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vantage-voice-models-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: Boolean(process.env.npm_config_host) || true
  },
  preview: {
    host: Boolean(process.env.npm_config_host) || true
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
