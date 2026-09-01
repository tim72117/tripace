import { Coffee, Gift, Landmark, UtensilsCrossed } from 'lucide-react'

// geoCuratedCategoryStub:精選點(散策羅盤,見 useAttractionOverlays.ts 的
// 主題點/精選點分級說明)的「店家分類」——目前是純前端寫死的對照表,不是
// 真正的資料欄位。理由:model.Attraction/GeoAttraction 完全沒有分類欄位
// (連 level 都已經被拿去做主題/精選點的區分,見 useAttractionOverlays.ts
// 的完整說明),使用者明確選擇「先試做」,只涵蓋目前已經用 attraction-add
// 手動建檔的清水寺周邊精選點,不是長久之計——這份表本身就是一次性的原型
// 資料,新建檔的店家不會自動有分類,需要手動在這裡補一筆對照。
//
// 分類依據沿用最初的構想稿(docs/research-curated-attraction-relationships-2026-08.md
// 之前的討論脈絡,清水寺周邊精選店家清單原始分類):
//   甜點/茶屋、傳統小吃/餐廳、工藝/伴手禮、街景/散策重點
// 四類——跟這批店家本身的性質相關,不是通用的「景點分類」系統。
export type CuratedCategory = 'tea' | 'restaurant' | 'craft' | 'street'

export const CURATED_CATEGORY_LABELS: Record<CuratedCategory, string> = {
  tea: '甜點/茶屋',
  restaurant: '傳統小吃/餐廳',
  craft: '工藝/伴手禮',
  street: '街景/散策重點',
}

// CURATED_CATEGORY_ICONS:跟 GeoOutlineMap.tsx CATEGORY_TAGS 用同一組
// lucide-react 圖示語彙(UtensilsCrossed 直接沿用「餐廳」標籤的既有圖示,
// 理由同該檔案的既有慣例——同樣的類型概念在不同地方出現時圖示要一致)。
export const CURATED_CATEGORY_ICONS: Record<CuratedCategory, typeof Coffee> = {
  tea: Coffee,
  restaurant: UtensilsCrossed,
  craft: Gift,
  street: Landmark,
}

// CURATED_CATEGORY_MAP_CLASS:地圖上精選點圓點(geoAttractionOverlay.ts
// 的 geo-attraction-curated-dot)依分類套用的固定字串 modifier class,
// 對應到 GeoOutlineMap.module.css 的顏色定義——理由同該檔案開頭對「這批
// class 是 innerHTML 動態組裝、必須用固定字串」的說明,這裡沿用同一套
// 命名慣例。顏色選用既有的、已有淺/深色雙版本定義的 base-ui.css token
// (不新增色票):tea 沿用圓點原本的 --ios-sand(暖沙棕,茶屋暖意);
// restaurant 用 --color-accent(硃紅,飲食聯想);craft 以 --ios-blue
// (大地棕,店舖/工藝)為基底、在 CSS 端 color-mix 壓暗一階(理由見
// GeoOutlineMap.module.css 的 -craft 規則——原色跟 tea 的暖沙棕色相太近,
// 14px 圓點分不出來);street 用 --ios-green(苔綠,街景/戶外聯想)。
export const CURATED_CATEGORY_MAP_CLASS: Record<CuratedCategory, string> = {
  tea: 'geo-attraction-curated-dot-tea',
  restaurant: 'geo-attraction-curated-dot-restaurant',
  craft: 'geo-attraction-curated-dot-craft',
  street: 'geo-attraction-curated-dot-street',
}

// NAME_TO_CURATED_CATEGORY:name → 分類的寫死對照表,只涵蓋目前已建檔的
// 清水寺周邊精選點(見 docs/handoff-radar-map-prototype-2026-08.md 建檔
// 記錄)。CHASEN 茶筅當初查不到精確座標而跳過建檔,故這裡也沒有它的條目。
const NAME_TO_CURATED_CATEGORY: Record<string, CuratedCategory> = {
  '忠僕茶屋': 'tea',
  '%ARABICA 京都東山': 'tea',
  '京都茶寮 産寧坂店': 'restaurant',
  '奧丹 清水店': 'restaurant',
  '順正': 'restaurant',
  '七味家本舖': 'craft',
  '松韻堂': 'craft',
  '朝日堂': 'craft',
  '八坂の塔（法観寺）': 'street',
  '產寧坂・三年坂': 'street',
  '二年坂': 'street',
}

export function curatedCategoryOf(name: string): CuratedCategory | null {
  return NAME_TO_CURATED_CATEGORY[name] ?? null
}
