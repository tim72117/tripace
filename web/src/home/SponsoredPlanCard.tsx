import { useEffect, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { trackEvent } from '../analytics'
import './SponsoredPlanCard.css'

// SponsoredPlanCard——主題景點頁顯示業主投放方案的共用卡片(2026-10
// 新增,對應 server/internal/api/ad_plans_public.go 的公開端點)。這是
// 業主自助控制台(web/partner)跟主站頁面之間唯一的連接點:業主在
// web/partner 建立 campaign(指定 placement)、底下的 plan 發布後,
// 這張卡片動態 fetch 出來顯示——不是像 JiufenPage.tsx 的
// KKDAY_AFFILIATE_URL 那樣寫死單一聯盟連結,而是真正讀取後端目前
// active 狀態的投放內容。
//
// placement 參數對應 server 端 campaignRow.Placement(見該欄位完整
// 說明:最小可行版本,單一字串對應單一頁面 slug),呼叫端(各主題頁)
// 傳自己的路由 slug 即可(例如 KyotoPage.tsx 傳 "kyoto-kiyomizu")。
//
// 沒有方案可顯示時整個元件回傳 null,不佔用任何版面——這是「贊助/
// 業主廣告」而非頁面核心內容,沒有東西可顯示時不該留一個空卡片框架
// 誤導讀者以為有東西載入失敗(對齊 frontend-design-guidelines「空
// 狀態」原則:但這裡更進一步是乾脆不渲染,因為這個區塊本身是可有
// 可無的,不是「使用者預期一定會有資料」的清單)。

interface PublicAdPlan {
  id: string
  campaignID: string
  category: string
  title: string
  status: string
  detail: string // JSON 字串,形狀見 web/partner/src/App.tsx 的 PlanDetail
  createdAt: string
  updatedAt: string
}

interface PublicAdPlansResponse {
  placement: string
  campaigns: { campaignID: string; plans: PublicAdPlan[] }[]
}

interface Departure {
  date: string
  weekday: string
  price: string
}

interface PlanDetail {
  departures: Departure[]
  days: string
  originalPrice: string
  highlights: string
  desc: string
  ctaLabel: string
  landingUrl: string
}

// parsePlanDetail——跟 web/partner/src/App.tsx 的同名函式邏輯一致
// (容錯解析、缺欄位補空字串、相容改成 departures 陣列之前用單一
// departureDate/price 欄位存的舊方案),但這裡不共用那份程式碼——
// web/partner 跟 web/ 是兩個完全獨立建置的 Vite 專案(互不 import,
// 見 web/admin 先例的既有模式),各自維護一份小型解析函式的重複維護
// 成本遠低於為此新增一個跨專案共用 package。
function parsePlanDetail(raw: string): PlanDetail {
  const empty: PlanDetail = { departures: [], days: '', originalPrice: '', highlights: '', desc: '', ctaLabel: '', landingUrl: '' }
  if (!raw) return empty
  try {
    const obj = JSON.parse(raw) as Partial<PlanDetail> & {
      departureDate?: string
      departureWeekday?: string
      price?: string
    }
    let departures = Array.isArray(obj.departures) ? obj.departures : []
    if (departures.length === 0 && (obj.departureDate || obj.price)) {
      departures = [{ date: obj.departureDate ?? '', weekday: obj.departureWeekday ?? '', price: String(obj.price ?? '') }]
    }
    return {
      departures: departures.map((d) => ({ date: d.date ?? '', weekday: d.weekday ?? '', price: String(d.price ?? '') })),
      days: obj.days ?? '',
      originalPrice: obj.originalPrice ?? '',
      highlights: obj.highlights ?? '',
      desc: obj.desc ?? '',
      ctaLabel: obj.ctaLabel ?? '',
      landingUrl: obj.landingUrl ?? '',
    }
  } catch {
    return empty
  }
}

export function SponsoredPlanCard({ placement }: { placement: string }) {
  const [plan, setPlan] = useState<PublicAdPlan | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${BASE_URL}/public/ad-plans?placement=${encodeURIComponent(placement)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PublicAdPlansResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return
        // 目前只取第一個活動的第一個方案渲染(見後端 ad_plans_public.go
        // 的完整說明:回應形狀保留分組結構供之後擴充多活動輪播,這裡
        // 先用最單純的「有就顯示第一筆」)。
        const first = data.campaigns[0]?.plans[0]
        setPlan(first ?? null)
      })
      .catch(() => {
        // 廣告版位載入失敗不影響頁面其他內容,靜默略過即可——不是
        // 使用者會在意的錯誤,也沒有重試的必要(下次造訪頁面會重新
        // fetch)。
      })
    return () => {
      cancelled = true
    }
  }, [placement])

  if (!plan) return null

  const detail = parsePlanDetail(plan.detail)
  const highlightLines = detail.highlights
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const { id: planId, campaignID } = plan

  function handleClick() {
    trackEvent('sponsored_plan_click', { placement, campaignId: campaignID, planId })
  }

  return (
    <section className="sponsored-plan-card">
      <span className="sponsored-plan-eyebrow">合作推薦</span>
      <h3 className="sponsored-plan-title">{plan.title}</h3>

      {detail.departures.length > 0 && (
        <div className="sponsored-plan-departures">
          {detail.days && <div className="sponsored-plan-days-badge">{detail.days} 天行程</div>}
          <div className="sponsored-plan-departures-grid">
            {detail.departures.map((dep, i) => (
              <div className="sponsored-plan-departure-chip" key={i}>
                <span className="sponsored-plan-departure-date">
                  {dep.date}
                  {dep.weekday && <span className="sponsored-plan-departure-weekday">（{dep.weekday}）</span>}
                </span>
                <span className="sponsored-plan-departure-price">{dep.price}</span>
              </div>
            ))}
          </div>
          {detail.originalPrice && <div className="sponsored-plan-original-price">原價 {detail.originalPrice}</div>}
        </div>
      )}

      {detail.desc && <p className="sponsored-plan-desc">{detail.desc}</p>}

      {highlightLines.length > 0 && (
        <ul className="sponsored-plan-highlights">
          {highlightLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

      {detail.landingUrl && (
        <a
          className="sponsored-plan-cta"
          href={detail.landingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
        >
          {detail.ctaLabel || '了解更多'}
        </a>
      )}
    </section>
  )
}
