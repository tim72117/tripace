import type { IdeaDoc } from '../types'

export const PRODUCT_DIRECTION_COMMON: IdeaDoc = {
  id: 'product-direction-common-observations',
  group: 'product',
  order: 16,
  title: '跨構想的共通觀察',
  summary: '整理完構想一到六後的三個跨構想主題:既有行程資料是被低估的資產、分潤/商業化是匯流點、使用者手動覆寫 AI 判斷是反覆出現的設計需求。',
  sections: [
    {
      heading: '前言',
      paragraphs: ['整理完這批產品方向構想後,有幾個跨構想的共通主題值得特別提出。'],
    },
    {
      heading: '1. 「既有行程資料」是一個被低估的資產',
      paragraphs: [
        '構想一(展示別人排過的行程)、構想三(依地點判斷規劃模式)、構想五(AI 產文時對照行程資料)、構想六(依頁面所屬城市精準投放)都可以共用同一份時間軸資料模型與「頁面對應城市」這個語境資訊。',
        '若這份資料的結構設計得夠彈性(例如構想三提到的「規劃模式標記」),可以同時服務好幾個構想,值得優先投資資料結構本身的彈性,而不是每個構想各自長出一套資料假設。',
      ],
    },
    {
      heading: '2. 「分潤/商業化」是多個構想的匯流點',
      paragraphs: [
        '構想四(一站式服務的服務串接分潤)、構想五(部落客分潤)、構想六(廣告投放系統)的商業邏輯高度重疊——構想六若從一開始就記錄「曝光發生在哪位作者的內容裡」,就能直接成為構想五部落客分潤的資料來源。',
        '建議未來設計分潤機制時一次設計成可以同時支援這幾種情境的通用系統,而非各自做一套。',
      ],
    },
    {
      heading: '3. 「使用者手動覆寫 AI 判斷」是反覆出現的設計需求',
      paragraphs: [
        '構想三(切換呈現模式)、構想四(行程健檢的警示可能有誤判)都暗示需要一個一致的 UI 模式——「AI 先判斷,使用者可以輕鬆覆寫」。',
        '這點也呼應手機版介面優化(構想二)裡提到的「相似元件統一」:如果要做好幾個地方都需要「AI 建議 + 使用者覆寫」的互動,值得抽出一套共用的 UI 模式(類似目前交通方式選單的設計),而不是每個地方各自設計一次。',
      ],
    },
    {
      heading: '相關構想',
      bullets: [
        '見構想 1(/ideas/product-direction-1-itinerary-showcase)',
        '見構想 2(/ideas/product-direction-2-mobile-ui)',
        '見構想 3(/ideas/product-direction-3-planning-modes)',
        '見構想 4(/ideas/product-direction-4-ai-automation)',
        '見構想 5(/ideas/product-direction-5-publishing-tool)',
        '見構想 6(/ideas/product-direction-6-ad-system)',
      ],
    },
  ],
  tags: ['共通觀察', '資料模型', '商業化'],
  source: ['docs/brainstorm/2026-10-product-direction-brainstorm.md'],
}
