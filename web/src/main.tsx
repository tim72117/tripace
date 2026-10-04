import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './base-ui.css'

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
    {/* HelmetProvider:讓 JiufenPage/KyotoPage 這類介紹頁能各自用
        <Helmet> 宣告專屬的 <title>(見這兩個檔案的完整說明)。
        description/OG/canonical 這類 meta/link 標籤改由
        server/cmd/server/seo_meta.go 的 seoMetaByPath 在 server 端
        統一輸出為唯一事實來源(2026-10 修正)——react-helmet-async 對
        這類標籤是用 DOM insert 新節點、不會移除 index.html 原有的
        靜態標籤,若仍由前端宣告,JS 執行後會同時存在兩份互相矛盾的
        宣告(例如兩個 canonical),Google 官方文件記載這種情況會直接
        忽略所有 canonical hint。title 則不受影響,保留在 Helmet——
        react-helmet-async 對 title 是直接覆寫 document.title,單一值
        覆寫不會重複/衝突,SPA 內部換頁時仍需要它才能正確更新分頁標題。
        不支援 JS 的傳統爬蟲/純文字分享預覽仍會退回 index.html 的
        server 端輸出值(有對應路由時已是該頁正確值,見 seo_meta.go)。 */}
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
)
