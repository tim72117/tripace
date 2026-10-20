import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 開發伺服器設定。預設跑在 5173,透過 CORS 直接打 Go server(預設 :8080)。
// 後端位址在 UI 的設定列可改,不寫死在這裡。
//
// PWA/service worker 支援已於 2026-10 整個移除(原本用 vite-plugin-pwa,
// 見 git 歷史)——根因是實測發現的真實 bug:「view-source 看京都清水寺
// 頁的 meta 永遠是首頁的,要重新整理/無痕模式都一樣」。這個專案所有
// 路徑共用同一份 index.html,不同路徑的 SEO meta(title/og:title/
// canonical 等)是伺服器端(cmd/server/seo_meta.go)依請求路徑即時改寫
// placeholder 產生的,每個路徑理應拿到不同內容。但 service worker 的
// navigateFallback 預設行為是「任何導航請求一律回填 precache 住的那份
// index.html,不再問伺服器」——這跟「每個路徑都要拿到不同動態內容」的
// SEO meta 機制直接衝突,導致訪客(含無痕模式,因為 service worker 一樣
// 會在無痕視窗裡註冊/攔截,無痕只影響 cookie/localStorage,不影響
// service worker)看到的一直是最早被 precache 住的那份路徑版本的 meta。
// 曾經試過用 navigateFallbackDenylist 一一排除需要動態內容的路徑,但
// 每新增一個公開頁面都要記得同步更新這份名單,否則會重現同一個 bug
// (已有過一次因忘記同步新路徑而差點重現的教訓),判斷這個維護負擔與
// 風險不值得換取「加到主畫面/離線開啟外殼」這個次要功能,改為整個
// 移除——不再有任何 service worker 被註冊,所有請求一律直接打伺服器。
export default defineConfig({
  plugins: [react()],
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
    //
    // *.integration.test.ts——2026-10 新增(使用者明確要求「這些元件
    // 寫前後端的整合測試,測試所有資源端點都可以正確讀取」):這批測試
    // 直接打真實本機 server(含 PostgreSQL、Google API key,見各測試
    // 檔案開頭的完整說明),不是像其餘 *.test.ts 那樣 mock fetch——在
    // 沒有起 server 的環境下(例如一般 `npx vitest run`、CI)執行這批
    // 測試只會整批連線失敗,不是測試本身有問題,所以用獨立副檔名排除在
    // 預設掃描範圍外,需要時改用 `npm run test:integration`(走獨立的
    // vitest.integration.config.ts,見該檔案的完整說明:vitest CLI 的
    // --exclude 只能附加、無法清空這裡的 exclude 設定,所以用獨立 config
    // 檔案而非 CLI flag 切換)執行。
    exclude: ['tests/**', '**/node_modules/**', 'admin/**', '**/*.integration.test.ts', '**/*.integration.test.tsx'],
  },
})
