import { Helmet } from 'react-helmet-async'
import { useParams } from 'react-router-dom'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import { SAMPLE_ITINERARIES } from './registry'
import { useListItineraries } from './useListItineraries'
import { AiItineraryListPage } from './AiItineraryListPage'
import { AiItineraryDetailPage } from './AiItineraryDetailPage'
import styles from './AiItinerariesRoute.module.css'

// useListItineraries(清單資料來源,含逾時處理)見 useListItineraries.ts。

// AiItinerariesRoute — 「精選行程」展示的頁面外殼,同時服務
// /itineraries(清單)與 /itineraries/:id(點進去的詳細頁)。2026-10
// 使用者明確要求「路由不要加 ai」,從原本的 /ai-itineraries 改名(見
// App.tsx 對應路由的完整說明),這個目錄/元件名稱維持不變,純粹是
// 對外路徑改名;後續使用者再次明確要求把頁面文案從「AI 排好的範例
// 行程」改成「精選行程」(見下方 Helmet/SiteNavBrand 實際渲染的文字),
// 同樣只改外顯文字,不動元件/目錄命名。
//
// 這是公開的展示頁(跟 /ai-plan 展示頁同性質),不需要登入;外殼的做法對齊
// planning/preview/Content.tsx:自己掛 app-theme-root + data-theme、
// 用 useThemeToggle 的暫時日夜切換(不寫 localStorage)、頂部用首頁同一組
// 浮動導覽按鈕(SiteNavButtons)。
//
// 整個功能都在 itineraries/ 這個獨立目錄:範例行程資料一份一個檔案放在
// example/,由 registry.ts 自動收進來(範例行程未來會持續增加),見
// types.ts 的設計說明。
//
// Helmet/SiteNavBrand 只在清單頁(!id)由這裡渲染,2026-10 改版(使用者
// 明確要求「標頭不要用 AI 排好的行程」「SEO 直接用行程標頭就好」):
// 詳細頁(id 有值)原本在這裡固定寫死 pageLabel="AI 排好的行程"、
// <title>AI 排好的範例行程 | Tripace</title>,不論點進哪一份行程都是
// 同一段文字,也沒有依行程內容產生對應的 SEO 標頭。這一層(AiItinerariesRoute)
// 只知道路由參數 id,不知道這個 id 實際對應哪份行程的標題/簡介(那份
// 資料要嘛來自 registry.ts 靜態清單、要嘛來自 API 查詢,查詢邏輯在
// AiItineraryDetailPage.tsx 內部),故改成由該元件(以及它可能轉交渲染
// 的 AiItineraryDetailPageMapView.tsx)拿到真正的 itinerary 物件後,
// 自己決定要顯示的 pageLabel/<title>/<meta description>——這兩個子
// 元件各自渲染自己的 SiteNavBrand/Helmet,不再依賴這裡的固定版本。
export function AiItinerariesRoute() {
  const { theme, dark, toggleTheme } = useThemeToggle()
  const { id } = useParams<{ id: string }>()
  const { items: listItems, loading: listLoading } = useListItineraries()

  return (
    <div className={`${styles.root} app-theme-root`} data-theme={theme ?? undefined}>
      {!id && (
        <>
          <Helmet>
            <title>精選行程 | Tripace</title>
            <meta name="description" content="看看精選的行程安排——挑一份行程,查看完整的時間軸。" />
          </Helmet>
          <SiteNavBrand pageLabel="精選行程" />
        </>
      )}
      <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
      <SiteNavCta href="/app">登入</SiteNavCta>
      {id ? <AiItineraryDetailPage items={SAMPLE_ITINERARIES} id={id} dark={dark} /> : <AiItineraryListPage items={listItems} loading={listLoading} />}
    </div>
  )
}
