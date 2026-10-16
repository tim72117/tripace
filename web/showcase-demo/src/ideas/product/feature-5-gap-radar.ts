import type { IdeaDoc } from '../types'

export const FEATURE_5: IdeaDoc = {
  id: 'product-feature-5-gap-radar',
  group: 'product',
  order: 44,
  title: '功能構想 5:空檔雷達(時間感知推薦)',
  summary: '偵測行程中的尷尬空檔,依「那個時刻你人在哪、還開著、體力剩多少、合不合口味」推薦補位選項,是現有 recommend_nearby 的直接升級。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['偵測尷尬空檔(「博物館 3 點結束、晚餐訂 6 點半」),依「那個時刻你人會在哪、還開著、體力剩多少、合不合口味」推薦補位選項。'],
    },
    {
      heading: '與現有推薦的差異',
      paragraphs: ['現有 recommend_nearby 是「以瀏覽位置為中心的靜態搜尋」;這是以未來時刻的位置 + 當時營業狀態 + 前後行程脈絡推理的多約束推薦,傳統篩選器組不出來。'],
    },
    {
      heading: '可行性',
      paragraphs: ['既有 Places Nearby/Text Search + 營業時間 + 時間軸脈絡,是現有推薦功能的直接升級。'],
      note: '命中率依賴對體力/意願的猜測,需以低打擾建議卡呈現而非自動插入。',
    },
  ],
  tags: ['功能腦力激盪', '推薦', 'recommend_nearby'],
  source: ['docs/feature-brainstorm.md'],
}
