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
