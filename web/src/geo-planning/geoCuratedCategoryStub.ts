import { Coffee, Gift, Landmark, UtensilsCrossed } from 'lucide-react'

// geoCuratedCategoryStub:精選點(散策羅盤,見 useAttractionOverlays.ts 的
// 主題點/精選點分級說明)的「店家分類」。model.Attraction/GeoAttraction
// 的 category 是真正的資料欄位(見兩者各自的完整說明),curatedCategoryOf
// 直接讀這個欄位——原本這裡還有一張 NAME_TO_CURATED_CATEGORY 過渡期
// fallback 表(用舊版 attraction-add、當時還沒有 -category flag 建檔的
// 既有資料補值前的權宜之計),2026-09 既有資料已逐筆用 tripace-cli
// attraction-update -field category -value <值> 補完(含展示頁固定
// fixture,見 kiyomizuDemoFixture.ts/yasakaDemoFixture.ts 的 category
// 欄位),這張表已整個移除,不再需要。
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

// CURATED_CATEGORY_ICONS:跟 ExploreMap.tsx CATEGORY_TAGS 用同一組
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
// 對應到 ExploreMap.module.css 的顏色定義——理由同該檔案開頭對「這批
// class 是 innerHTML 動態組裝、必須用固定字串」的說明,這裡沿用同一套
// 命名慣例。顏色選用既有的、已有淺/深色雙版本定義的 base-ui.css token
// (不新增色票):tea 沿用圓點原本的 --ios-sand(暖沙棕,茶屋暖意);
// restaurant 用 --color-accent(硃紅,飲食聯想);craft 以 --ios-blue
// (大地棕,店舖/工藝)為基底、在 CSS 端 color-mix 壓暗一階(理由見
// ExploreMap.module.css 的 -craft 規則——原色跟 tea 的暖沙棕色相太近,
// 14px 圓點分不出來);street 用 --ios-green(苔綠,街景/戶外聯想)。
export const CURATED_CATEGORY_MAP_CLASS: Record<CuratedCategory, string> = {
  tea: 'geo-attraction-curated-dot-tea',
  restaurant: 'geo-attraction-curated-dot-restaurant',
  craft: 'geo-attraction-curated-dot-craft',
  street: 'geo-attraction-curated-dot-street',
}

const VALID_CURATED_CATEGORIES: ReadonlySet<string> = new Set<CuratedCategory>([
  'tea', 'restaurant', 'craft', 'street',
])

// curatedCategoryOf:讀後端 GeoAttraction.category(見該欄位完整說明)
// ——後端刻意不驗證列舉值(比照 name/summary 等自由字串欄位的既有慣例),
// 故這裡要自己檢查是不是這四個合法值之一,不是合法值時視同未設定
// (回傳 null,而非把不明字串硬塞進型別)。category 缺值(這個景點本來
// 就不適用這四類語彙,或尚未建檔時填入分類)時回傳 null,呼叫端據此
// 決定不顯示分類 icon/不計入篩選(見 AttractionInfoPanel.tsx 的
// nearbyCategoryPresent/filteredNearby)。
export function curatedCategoryOf(category?: string): CuratedCategory | null {
  if (category && VALID_CURATED_CATEGORIES.has(category)) {
    return category as CuratedCategory
  }
  return null
}
