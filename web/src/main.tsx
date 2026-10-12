import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { App } from './App'
import './base-ui.css'
import './components/zLayers.css'

// PWA/service worker 支援已於 2026-10 整個移除(見 vite.config.ts 開頭
// 說明的完整理由:service worker 的 navigateFallback 攔截了需要伺服器端
// 動態 SEO meta 的公開頁面,導致「view-source 看到的 meta 永遠是最早
// precache 住的那個路徑版本」的真實 bug)。這裡原本呼叫 registerSW 觸發
// service worker 註冊,現在整段移除——不再有任何 service worker 被註冊,
// 也不再支援「加到主畫面」離線外殼。
//
// unregisterStaleServiceWorkers:只移除「安裝」的程式碼不夠——部署這次
// 改動之前就已經造訪過本站、瀏覽器裡還留著舊版 service worker 的訪客,
// 不會因為伺服器端換了新版 dist/ 就自動擺脫它(舊 service worker 賴以
// 自動更新/卸載的 registerSW/autoUpdate 機制本身也被整個移除了,沒有
// 新版本可以比對,會原地繼續運作、永遠不會自然消失),等於這批訪客會
// 繼續卡在被攔截回填舊 index.html 快照的狀態,是「只刪安裝邏輯沒刪
// 殘留」的真實疏漏。這裡在應用啟動時明確找出並卸載任何殘留的 service
// worker、清掉它們的 Cache Storage(avoid 殘留的 precache 內容在卸載後
// 還被其他程式碼意外讀到),讓這批訪客的下一次導航(通常是下一次換頁
// 或重新整理)回到「沒有 service worker」的乾淨狀態。只在偵測到瀏覽器
// 支援 serviceWorker API 時執行(避免在不支援的環境丟出例外),且
// best-effort——卸載失敗不影響應用本身能否啟動。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister().catch(() => {})
    })
  }).catch(() => {})
  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key).catch(() => {})
      })
    }).catch(() => {})
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* HelmetProvider:讓 JiufenPage/KyotoPage/ProductPage 這類介紹頁
        能各自用 <Helmet> 宣告專屬的 <title>(見各檔案的完整說明)。
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
