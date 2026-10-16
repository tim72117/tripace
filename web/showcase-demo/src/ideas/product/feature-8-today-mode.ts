import type { IdeaDoc } from '../types'

export const FEATURE_8: IdeaDoc = {
  id: 'product-feature-8-today-mode',
  group: 'product',
  order: 47,
  title: '功能構想 8:今天模式 + 現場救援',
  summary: '旅行當天打開 app 直接看到「現在 → 下一站」大卡片,途中一句話(下大雨、臨時公休、晚了 40 分鐘)讓 AI 依位置與時間改寫今天剩餘行程。雙視角命中。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['旅行當天打開 app 直接是「現在 → 下一站」大卡片,附導航入口與離線快取;途中一句「現在下大雨」「這間臨時公休」「我們晚了 40 分鐘」,AI 以目前位置與時間改寫今天剩餘行程,保住訂位等鎖定項目。'],
    },
    {
      heading: '為什麼非 AI 不可',
      paragraphs: ['站在路邊淋雨用手機拖曳排程是災難;「一句話 + GPS」重排是傳統 UI 完全給不了的體驗。「延誤自動重排」沒有對手做到。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['旅途中一天打開八次的 app,回國後也不會被刪。'],
    },
    {
      heading: '可行性',
      paragraphs: ['資料都在,重排直接重用現有工具管線;需新增行動版視圖、離線快取、項目鎖定標記。'],
      note: '反應速度是生死線。',
    },
  ],
  tags: ['功能腦力激盪', '旅途中', '離線', '重排', '雙視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
