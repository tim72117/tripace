import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_05: IdeaDoc = {
  id: 'research-storytelling-05',
  group: 'research',
  order: 5,
  title: '點子 5:旅人一句話(UGC 精選心得)',
  summary: '行程結束後邀請使用者留一句話給下個旅人,經策展人審核後以便條風格呈現在介紹卡。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: [
        '站內回收——使用者行程結束後(行程日期已過)推一次「這個點值得嗎?留一句話給下個旅人」;策展人審核後上架。',
        '冷啟動期可人工從公開遊記「改寫轉述」觀點(不直接複製 Google 評論全文,避免 ToS 與著作權風險——Places API 內容不可離開 Google 服務快取展示,這條路法務上不建議)。',
      ],
    },
    {
      heading: '如何介紹',
      paragraphs: ['介紹卡下方 2–3 則手寫便條風格輪播,署名「來自 2026 春的旅人」+旅伴型態標籤(帶小孩/獨旅)。'],
    },
    {
      heading: '如何引導',
      paragraphs: ['讀端自然出現在卡片內;寫端靠行程結束後的一次性提示,寫一句話門檻極低。'],
    },
    {
      heading: '增強使用者感受',
      paragraphs: ['解決「官方簡介像廣告、缺真實社會證明」。旅伴型態標籤讓使用者找到「跟我一樣的人怎麼說」。'],
    },
  ],
  verdict: '可行性/優先度:中。機制便宜,但依賴使用者基數,冷啟動期會很空。適合等 DAU 有量之後再開,開了之後幾乎零維護成本。',
  tags: ['景點介紹', 'UGC', '社會證明'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
