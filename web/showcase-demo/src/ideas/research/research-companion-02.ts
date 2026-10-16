import type { IdeaDoc } from '../types'

export const RESEARCH_COMPANION_02: IdeaDoc = {
  id: 'research-companion-02',
  group: 'research',
  order: 41,
  title: '旅伴應徵配對:配對條件維度',
  summary: '發起應徵時勾選三類條件:基本資料、旅行風格、行程相關;硬性篩選或軟性參考尚待決定。',
  sections: [
    {
      heading: '三類條件(發起應徵時勾選)',
      bullets: [
        '基本資料:年齡層區間、性別(含不限)。',
        '旅行風格:步調(淡定 ↔ 高強度)、預算區間、體驗傾向(例如「行程彈性 vs 按表操課」)——具體選項清單待細部設計時再定,先確定「風格類條件」是獨立於基本資料的一類。',
        '行程相關:日期(區間或彈性範圍,需跟路徑本身若已綁日期時互相檢查是否衝突)、同行人數需求(還缺幾人)。',
      ],
    },
  ],
  verdict: '待討論:條件是「發起人設好門檻,應徵者需符合才能提出配對」的硬性篩選,還是「發起人設定的是偏好,應徵者條件不同仍可提出、由發起人自行決定要不要接受」的軟性參考?這會決定配對邏輯是規則過濾還是純展示排序,先記下來,細部設計時要問清楚。',
  tags: ['旅伴配對', '配對條件'],
  source: ['docs/research-travel-companion-matching-2026-08.md'],
}
