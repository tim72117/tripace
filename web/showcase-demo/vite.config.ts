import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 獨立展示小站，從 web/src/showcase-demo/ 搬出來的產品方向雛形集合
// （見構想頁 /ideas/product-direction-*）。跟主站
// web/ 完全切分：自己的 package.json/node_modules/dev server，不再掛在
// 主站路由底下，不共用任何 web/src 的程式碼（原本就是純自包含、假資料，
// 搬動前已確認沒有跨目錄 import）。
//
// Dev server 用 5175——主站 web/ 用 5173、web/admin/ 用 5174，這是下一個
// 未使用的連續號碼。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
  },
})
