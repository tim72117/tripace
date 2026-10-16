import type { IdeaDoc } from '../types'

export const FEATURE_9: IdeaDoc = {
  id: 'product-feature-9-expense-splitting',
  group: 'product',
  order: 48,
  title: '功能構想 9:旅費分帳',
  summary: '每張行程卡可掛預估與實際花費,旅途中一句話或拍收據記帳,自動綁行程項目、按人拆分、換匯,結束時算出最少轉帳次數的結清方案。雙視角命中。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['每張行程卡可掛預估與實際花費,自動加總每日/總預算;旅途中一句話或拍收據記帳(「我付了四人晚餐 3200」),自動綁行程項目、按人拆分、換匯,結束時算出最少轉帳次數的結清方案。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['多數人跳回 Google 試算表的最大理由就是「要算錢」;把錢綁在行程卡上,拆掉試算表最後一個存在理由。'],
    },
    {
      heading: 'AI 角色',
      paragraphs: ['自然語言/收據照片 → 結構化帳目(降低輸入摩擦);拆分與結清演算法不需 AI。'],
    },
    {
      heading: '可行性',
      paragraphs: ['純 CRUD + 匯率 API,無技術風險。'],
      note: '難點是記帳流程必須壓到三秒內完成,比開 Splitwise 更少步驟才有人用。',
    },
  ],
  tags: ['功能腦力激盪', '記帳', '分帳', '雙視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
