import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 開發伺服器設定。預設跑在 5173,透過 CORS 直接打 Go server(預設 :8080)。
// 後端位址在 UI 的設定列可改,不寫死在這裡。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
})
