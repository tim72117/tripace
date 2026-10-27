// sidebarData.ts——把行程資料的 sidebar 欄位(見 types.ts SampleSidebar)變成畫面實際要
// 渲染的內容(純函式)。
//
// 這個欄位可能來自 API(itinerary_pages content JSON),格式與內容都不能信任,所以這裡
// 一律當 unknown 檢查,不合格的項目直接丟掉:
//   - 連結只收站內路徑,擋掉 javascript:、data:、//外部網址、含空白或反斜線的字串。
//   - 廣告的 href 與 imageUrl 只收 https。
//   - 數量與文字長度有上限,避免一份壞資料把側欄撐爆。
// 沒設定 sidebar(或欄位型別不對)時,退回全站預設連結(sidebarDefaults.ts)。

import { DEFAULT_SIDEBAR_SECTIONS } from './sidebarDefaults'
import type { SampleItinerary, SampleSidebarAd } from './types'

export const MAX_SECTIONS = 4
export const MAX_LINKS_PER_SECTION = 8
export const MAX_HEADING_LENGTH = 30
export const MAX_LABEL_LENGTH = 60
export const MAX_HINT_LENGTH = 40
export const MAX_AD_ALT_LENGTH = 100

export interface SidebarLink {
  // id——只給 React key 用。
  id: string
  label: string
  hint: string
  to: string
}

export interface SidebarSection {
  heading: string
  links: ReadonlyArray<SidebarLink>
}

export type ResolvedSection = SidebarSection

export interface ResolvedSidebar {
  sections: ResolvedSection[]
  // ad——有可用的廣告時是該廣告;null 就不渲染廣告版位(連「廣告」標示都不出現,不留預留框)。
  ad: SampleSidebarAd | null
}

// 單一個 / 開頭(不是 // 開頭的協定相對網址),且不含空白、反斜線與控制字元。
const INTERNAL_PATH = /^\/(?!\/)[^\s\\\u0000-\u001f]*$/

export function isInternalPath(v: unknown): v is string {
  return typeof v === 'string' && INTERNAL_PATH.test(v)
}

export function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.username === '' && u.password === ''
  } catch {
    return false
  }
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 && t.length <= max ? t : null
}

// sanitizeSections——檢查資料給的區段。回傳通過檢查的區段(沒有任何有效連結的區段整段丟掉)。
// 連結 id 用「區段序號-連結序號」,只給 React key 用。
export function sanitizeSections(raw: unknown): ResolvedSection[] {
  if (!Array.isArray(raw)) return []
  const out: ResolvedSection[] = []
  raw.slice(0, MAX_SECTIONS).forEach((sec, si) => {
    if (typeof sec !== 'object' || sec === null) return
    const { heading: rawHeading, links: rawLinks } = sec as Record<string, unknown>
    const heading = cleanText(rawHeading, MAX_HEADING_LENGTH)
    if (heading === null || !Array.isArray(rawLinks)) return
    const links: SidebarLink[] = []
    rawLinks.slice(0, MAX_LINKS_PER_SECTION).forEach((l, li) => {
      if (typeof l !== 'object' || l === null) return
      const { label: rawLabel, to, hint: rawHint } = l as Record<string, unknown>
      const label = cleanText(rawLabel, MAX_LABEL_LENGTH)
      if (label === null || !isInternalPath(to)) return
      links.push({ id: `${si}-${li}`, label, hint: cleanText(rawHint, MAX_HINT_LENGTH) ?? '', to })
    })
    if (links.length > 0) out.push({ heading, links })
  })
  return out
}

export function sanitizeAd(raw: unknown): SampleSidebarAd | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { href, imageUrl, alt } = raw as Record<string, unknown>
  const cleanAlt = cleanText(alt, MAX_AD_ALT_LENGTH)
  if (!isHttpsUrl(href) || !isHttpsUrl(imageUrl) || cleanAlt === null) return null
  return { href, imageUrl, alt: cleanAlt }
}

export function resolveSidebar(itinerary: SampleItinerary, defaultAd: SampleSidebarAd | null): ResolvedSidebar {
  const data = itinerary.sidebar
  const manual = data != null && typeof data === 'object' && Array.isArray(data.sections)
  const sections: ResolvedSection[] = manual ? sanitizeSections(data!.sections) : [...DEFAULT_SIDEBAR_SECTIONS]

  // ad:undefined 用全站預設(沒有預設就不顯示);null 明確不顯示;其他(物件或壞資料)當作這份行程
  // 自己的廣告,沒通過檢查就不顯示,不退回全站預設——作者既然寫了就不該默默換成別的廣告。
  const adField = data != null && typeof data === 'object' ? data.ad : undefined
  if (adField === null) return { sections, ad: null }
  return { sections, ad: adField === undefined ? sanitizeAd(defaultAd) : sanitizeAd(adField) }
}
