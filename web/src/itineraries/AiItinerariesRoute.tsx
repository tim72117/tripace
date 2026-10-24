import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useParams } from 'react-router-dom'
import { BASE_URL } from '../AppCommon'
import { fetchPublicItineraryPageList, type ClientConfig } from '../api'
import { useThemeToggle } from '../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../home/SiteNavButtons'
import { SAMPLE_ITINERARIES } from './registry'
import { isSampleItineraryShape, mergeWithApiItineraries } from './catalog'
import type { SampleItinerary } from './types'
import { AiItineraryListPage } from './AiItineraryListPage'
import { AiItineraryDetailPage } from './AiItineraryDetailPage'
import styles from './AiItinerariesRoute.module.css'

// GUEST_CFG——讀取已發布範例行程清單是公開頁面的訪客動作,理由同
// AiItineraryDetailPage.tsx 的 GUEST_CFG。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// SHOW_EXAMPLE_ITINERARIES_ENABLED——2026-10 新增,使用者明確要求「排
// 好的行程清單,用參數控制要不要顯示範例,預設關閉」:同 DesktopShared.tsx
// TIMELINE_ENABLED/PACE_ENABLED 那套編譯時 feature flag 機制(部署環境
// 變數,預設關閉,只在明確設為字串 "true" 時才啟用),不是另外發明一套
// ——只是放在這裡而非 DesktopShared.tsx,因為那個檔案服務的是 /app 規劃
// UI 的面板開關,跟這個獨立的範例行程展示頁(/itineraries)是不同功能、
// 不同關注點,放這裡保持就近維護。
//
// 只影響清單頁(AiItineraryListPage)要不要把 registry.ts 的靜態
// SAMPLE_ITINERARIES 併進清單——不影響詳細頁(AiItineraryDetailPage):
// 關閉這個旗標後,example/*.ts 裡的行程仍然可以透過直接網址
// (/itineraries/erziping-1day 這類)瀏覽,只是不會出現在清單頁讓訪客
// 隨意逛到,理由是這些仍是真實、完整、測試過的範例行程內容,只是「清單
// 預設只秀資料庫正式發布的行程」這個呈現策略改變,不是要把這些行程
// 整個下架。
const SHOW_EXAMPLE_ITINERARIES_ENABLED = import.meta.env.VITE_FEATURE_SHOW_EXAMPLE_ITINERARIES === 'true'

// useListItineraries——清單頁顯示的行程 = (視 SHOW_EXAMPLE_ITINERARIES_ENABLED
// 決定要不要併入)靜態 registry.ts + 已發布進資料庫的行程(見
// mergeWithApiItineraries 的完整說明)。2026-10 新增——清單頁原本只讀
// SAMPLE_ITINERARIES,從沒打過 fetchPublicItineraryPageList,導致透過
// CLI 發布的行程(例如 tainan-chikan-2day、jozankei-1day)雖然詳細頁能
// 看到,卻不會出現在 /itineraries 清單上(使用者回報「沒有看到」才發現
// 這個落差)。查詢失敗(網路層級問題、500 等)時直接退回純靜態清單(或
// 空清單,視旗標而定),不讓清單頁整頁壞掉——清單頁本來就能在沒有任何
// API 行程的情況下正常運作。
function useListItineraries(): SampleItinerary[] {
  const [apiItems, setApiItems] = useState<SampleItinerary[]>([])

  useEffect(() => {
    let cancelled = false
    fetchPublicItineraryPageList(GUEST_CFG)
      .then((res) => {
        if (cancelled) return
        const items = res.itineraryPages
          .map((p) => p.content)
          .filter(isSampleItineraryShape)
        setApiItems(items)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[AiItinerariesRoute] fetchPublicItineraryPageList 失敗:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return mergeWithApiItineraries(SHOW_EXAMPLE_ITINERARIES_ENABLED ? SAMPLE_ITINERARIES : [], apiItems)
}

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
  const listItems = useListItineraries()

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
      {id ? <AiItineraryDetailPage items={SAMPLE_ITINERARIES} id={id} dark={dark} /> : <AiItineraryListPage items={listItems} />}
    </div>
  )
}
