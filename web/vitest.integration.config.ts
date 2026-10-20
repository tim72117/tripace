import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// vitest.integration.config.ts — 2026-10 新增(使用者明確要求「這些元件
// 寫前後端的整合測試,測試所有資源端點都可以正確讀取」):*.integration.
// test.ts 這批測試需要真實本機 server(見各測試檔案開頭的完整說明),
// vite.config.ts 的預設 exclude 刻意排除它們(見該檔案 exclude 設定的
// 完整說明),不會被一般 `npm test`/CI 掃到。
//
// vitest CLI 的 --exclude 只能「附加」排除規則,無法清空 vite.config.ts
// 既有的 exclude 設定(試過 `vitest run --exclude=''` 仍然套用 config
// 裡的 exclude,CLI 層級的篩選是交集,不是覆蓋),所以另外建這份獨立
// config:只給整合測試用,include 只收 *.integration.test.ts,不繼承
// vite.config.ts 的 exclude 清單。跟主要的 vite.config.ts 刻意分開
// 兩個檔案,而不是共用一份再用 CLI flag 切換,原因就是上面這個 CLI
// 限制——flag 做不到「清空再重新指定」。
//
// 執行:npm run test:integration(見 package.json)。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // .ts 跟 .tsx 都要收——AskPage.candidates.integration.test.tsx
    // (render 元件那一層,見該檔案開頭的完整說明)用 JSX,副檔名是
    // .test.tsx,只收 .test.ts 會漏掉它。
    include: ['src/**/*.integration.test.ts', 'src/**/*.integration.test.tsx'],
  },
})
