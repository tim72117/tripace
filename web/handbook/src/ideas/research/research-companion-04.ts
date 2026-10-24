import type { IdeaDoc } from '../types'

export const RESEARCH_COMPANION_04: IdeaDoc = {
  id: 'research-companion-04',
  group: 'research',
  order: 43,
  title: '旅伴應徵配對:待決策項目',
  summary: '下次接續討論時要處理的五項:篩選方式、曝光範圍、信任與安全、資料庫 schema、聊天室基礎設施。',
  sections: [
    {
      heading: '待決策項目(下次接續討論時處理)',
      bullets: [
        '配對條件是硬性篩選還是軟性參考(見配對條件維度一頁)。',
        '應徵貼文的曝光範圍:公開給所有使用者瀏覽,還是需要先加好友/追蹤才看得到?',
        '信任與安全機制:要不要有檢舉、封鎖、身分驗證等級之類的機制——旅伴配對涉及真人見面,安全性比純內容分享的路徑功能更需要謹慎設計,這塊還完全沒討論。',
        '資料庫 schema(應徵貼文表、配對申請表、跟路徑表/聊天室既有機制的關聯)。',
        '聊天室要新建一套,還是能重用專案裡既有的即時通訊基礎設施(如果有的話,需要先盤點)。',
      ],
    },
  ],
  tags: ['旅伴配對', '待決策', '安全'],
  source: ['docs/research-travel-companion-matching-2026-08.md'],
}
