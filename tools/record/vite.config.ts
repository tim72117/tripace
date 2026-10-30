import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 錄製專用頁的 dev server——獨立於 web/ 的主站 dev server(5173),不會被打包進正式站。
// 埠固定(strictPort),錄製腳本(record-ai-plan.ts)預設連這個埠。
export default defineConfig({
  plugins: [react()],
  server: { port: 5195, strictPort: true },
})
