import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    // Only dev:uat enables these loopback-only proxies. No production fallback.
    ...(process.env.RHI_LOCAL_UAT === 'true' ? {
      proxy: Object.fromEntries(
        ['/auth/v1', '/rest/v1', '/storage/v1', '/functions/v1', '/realtime/v1', '/__rhi/uat']
          .map(route => [route, { target: 'http://127.0.0.1:18080', changeOrigin: true, ws: route === '/realtime/v1' }]),
      ),
    } : {}),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      devOptions: {
        enabled: false
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        globPatterns: [
          'index.html',
          'assets/index-*.js',
          'assets/index-*.css',
          'assets/vendor-runtime-*.js',
          'assets/vendor-react-*.js',
          'assets/vendor-supabase-*.js',
          'assets/vendor-utils-*.js',
          'assets/vendor-ui-*.js',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/backup(?:\/|$)/, /^\/manifest\.webmanifest$/, /^\/release\.json$/],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.(?:js|css)$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'rhi-runtime-static-v2',
              networkTimeoutSeconds: 8,
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /\/(?:assets|platform-logos)\/.*\.(?:png|jpg|jpeg|svg|webp|gif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rhi-runtime-images-v1',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
        skipWaiting: false,
      },
      includeAssets: [
        'polesheadlamp-app-logo-round-192.png',
        'polesheadlamp-app-logo-round-512.png',
      ],
      manifest: {
        id: '/',
        lang: 'id',
        name: 'Restoration Headlamp Indonesia',
        short_name: 'RHI System',
        description: 'Sistem Manajemen Operasional Teknisi Restoration Headlamp Indonesia',
        theme_color: '#0F172A',
        background_color: '#F8FAFC',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'polesheadlamp-app-logo-round-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'polesheadlamp-app-logo-round-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (
            normalizedId.includes('vite/preload-helper') ||
            normalizedId.includes('commonjsHelpers') ||
            normalizedId.includes('rollupPluginBabelHelpers')
          ) return 'vendor-runtime'

          if (!normalizedId.includes('node_modules')) return undefined

          if (
            normalizedId.includes('/node_modules/clsx/') ||
            normalizedId.includes('/node_modules/tailwind-merge/') ||
            normalizedId.includes('/node_modules/class-variance-authority/')
          ) return 'vendor-utils'

          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/react-router/') ||
            normalizedId.includes('/node_modules/scheduler/')
          ) return 'vendor-react'
          if (normalizedId.includes('@supabase')) return 'vendor-supabase'
          if (normalizedId.includes('@radix-ui') || normalizedId.includes('cmdk') || normalizedId.includes('vaul')) return 'vendor-ui'
          if (normalizedId.includes('recharts') || normalizedId.includes('/d3-')) return 'vendor-charts'
          if (normalizedId.includes('html2canvas')) return 'vendor-html2canvas'
          if (normalizedId.includes('jspdf')) return 'vendor-pdf'
          if (normalizedId.includes('xlsx')) return 'vendor-xlsx'
          if (normalizedId.includes('papaparse')) return 'vendor-csv'
          if (normalizedId.includes('leaflet')) return 'vendor-map'

          return undefined
        },
      },
    },
  },
})
