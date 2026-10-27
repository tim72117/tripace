import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 業主控制台 SPA,比照 web/admin/vite.config.ts 的既有模式(見該檔案
// 完整說明)。base: '/partner/' 對應 cmd/partnerserver 的掛載路徑;
// dev server 用 5175 port,與主站(5173)、admin(5174)互不衝突,三者
// 可同時啟動。
export default defineConfig({
  base: '/partner/',
  plugins: [react()],
})
