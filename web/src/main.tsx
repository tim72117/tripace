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
        <Helmet> 宣告專屬的 title/description/OG/canonical(見這兩個檔案
        的完整說明)——整站是純 client-side SPA,index.html 裡的這批 meta
        標籤原本是所有路由共用的一份,搜尋引擎/社群分享 bot 看到的永遠是
        首頁的標題與描述,不是實際瀏覽頁面的內容。react-helmet-async 在
        client 端掛載後動態改寫 <head>,支援執行 JS 的爬蟲(Googlebot 等
        現代爬蟲都會執行 JS)可以正確讀到每頁各自的 meta;不支援 JS 的
        傳統爬蟲/純文字分享預覽仍會退回 index.html 的預設值,這是
        client-side rendering 架構的已知限制,之後若要完全解決需要
        SSR/預渲染,不在這次改動範圍內。 */}
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
)
