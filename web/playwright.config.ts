import { defineConfig } from '@playwright/test'

// 這份設定服務 tests/ 底下所有端到端測試,不是給一般 UI 元件測試用。刻意
// 保持精簡,只設真的需要覆寫預設值的欄位,其餘用 Playwright 官方預設。
//
// e2e-geo-outline.spec.ts(規劃分頁互動完全不經過 AI)直接對著開發者平常在跑的
// dev 環境(server :8080 + web dev server)測試,不用 Playwright 的 webServer
// 選項自動起 dev server,見該檔案開頭說明。(原本的 e2e-mock-llm.spec.ts 與
// mockllm/啟動腳本已移除。)
export default defineConfig({
  testDir: './tests',
  timeout: 30_000, // 見各 spec 內個別 expect 的逾時設計說明
  // 目前測試共用同一組後端種子資料(種子行程「產品討論」/
  // ch_001),平行跑會互相干擾對方操作的資料狀態,故關閉平行執行。
  fullyParallel: false,
  retries: 0, // 失敗要如實反映(flaky 用重試蓋過去只會掩蓋真正的時序問題)
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure', // 失敗時保留追蹤記錄,方便事後排查是哪一步斷言錯
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
