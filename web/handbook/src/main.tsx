import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// base-ui.css/zLayers.css:複製自主站 web/src/(搬出成獨立套件前,handbook
// 各頁面的 CSS Modules 大量使用 var(--ios-bg)/var(--color-accent) 等變數,
// 原本靠主站 main.tsx 全域載入這份檔案才解析得到值。獨立成自己的
// package.json/dev server 後需要自行載入,否則這些變數全部 fallback 失敗、
// 頁面變成只剩排版結構、沒有任何背景色/強調色——複製一份保持自包含,
// 之後主站若調整品牌色系,這裡需要同步更新。
import './base-ui.css'
import './components/zLayers.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
