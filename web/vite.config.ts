import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 開發伺服器設定。預設跑在 5173,透過 CORS 直接打 Go server(預設 :8080)。
// 後端位址在 UI 的設定列可改,不寫死在這裡。
export default defineConfig({
  plugins: [
    react(),
    // PWA 設定:僅供手機「加到主畫面」使用的標準安裝設定,刻意保守、
    // 不做離線優先重寫。這個 App 有即時聊天/WebSocket 功能跟真實資料 API,
    // service worker 只 precache 建置產物本身(JS/CSS/HTML/icons),
    // 讓 App 外殼可以離線開啟——絕對不快取任何 API 回應或 WebSocket 連線,
    // 所以刻意不寫 workbox.runtimeCaching 規則(完全不設定 runtimeCaching
    // 就是最安全的做法,寧可少快取也不要誤快取到即時資料)。
    VitePWA({
      registerType: 'autoUpdate',
      // devOptions.enabled:vite-plugin-pwa 預設只在正式 build(npm run
      // build 產出的 dist/)才會注入 manifest link/啟用 service worker,
      // dev server(:5173)預設完全不啟用——這個專案的本機測試/除錯全程
      // 都是直接用 dev server(見這個 session 反覆用 :5173 測試的慣例),
      // 不開這個選項的話,Chrome DevTools 在 dev server 底下永遠會顯示
      // 「no Manifest detected」,不是設定壞掉,是預設就沒開。
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Tripace',
        short_name: 'Tripace',
        lang: 'zh-Hant',
        description:
          'Tripace 讓你用自然語言記錄行程，AI 自動整理成事項、時間與地點，排上時間軸、歸成一趟行程，還能和同行的人一起編輯、免登入分享。',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        background_color: '#F5F2ED',
        theme_color: '#C4956A',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 只 precache 靜態建置產物,不設定任何 runtimeCaching 規則。
        // 動態端點(/v1/*、/internal/*、WebSocket /v1/trips/*/ws)
        // 一律不經過 service worker 快取,永遠直接打網路。
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // navigateFallback 預設會把所有瀏覽器導航請求(網址列輸入、
        // reload,即 mode=navigate)一律導回快取的 index.html,不分
        // 副檔名——這會導致直接開 /robots.txt、/sitemap.xml 這種
        // 非 HTML 靜態檔也被攔截成 SPA 外殼,而不是真正的檔案內容。
        // 明確排除這兩個路徑,讓它們照常打到伺服器拿實際檔案。
        navigateFallbackDenylist: [/^\/robots\.txt$/, /^\/sitemap\.xml$/],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // tests/ 底下是 Playwright 的 E2E 測試(test:e2e:mockllm 腳本專用),
    // 跟 Vitest 是不同框架、test.describe 語法互相衝突,必須排除,不能讓
    // Vitest 掃到那個目錄。admin/ 是獨立的另一個子專案(有自己的
    // node_modules),預設的 node_modules/** exclude 不會遞迴排除到子目錄
    // 裡的 node_modules,必須額外明講排除整個 admin/ 目錄。
    exclude: ['tests/**', '**/node_modules/**', 'admin/**'],
  },
})
