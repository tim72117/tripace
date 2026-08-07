import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './styles.css'
import './styles-login.css'
import './styles-desktop.css'
import './styles-demo.css'

// registerSW:vite-plugin-pwa 只在 build 時產生 service worker(dist/sw.js)
// 與 registerType: 'autoUpdate' 設定(見 vite.config.ts),並不會自動幫
// 應用程式呼叫瀏覽器的 navigator.serviceWorker.register——這支函式(來自
// 該 plugin 注入的虛擬模組 virtual:pwa-register)才是實際觸發註冊、並依
// registerType 設定接手「偵測到新版本就自動 skipWaiting + 接管」這套行為
// 的地方。先前完全沒有呼叫這支函式,導致 service worker 從未被註冊過
// (即使 dist/ 底下確實有產出 sw.js),也就永遠不會有任何自動更新發生。
// 只在正式環境呼叫(import.meta.env.PROD)——dev server 底下呼叫這個虛擬
// 模組會因為 devOptions.enabled 走 module 型別的 service worker,行為與
// 正式版不同,且開發時本來就即時看得到程式碼變動,不需要 SW 更新機制。
if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
