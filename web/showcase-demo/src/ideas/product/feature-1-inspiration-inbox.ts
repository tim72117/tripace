import type { IdeaDoc } from '../types'

export const FEATURE_1: IdeaDoc = {
  id: 'product-feature-1-inspiration-inbox',
  group: 'product',
  order: 40,
  title: '功能構想 1:靈感收件匣(貼上即成行程)',
  summary: '把 IG/小紅書/YouTube/部落格連結、截圖、朋友訊息或議程整段貼進來,AI 抽出地點並比對成 Google Places 真實地標,收進候選池並建議可插入的時段。三視角命中。',
  sections: [
    {
      heading: '背景',
      note: '功能腦力激盪由三個獨立視角(繁瑣痛點簡化、AI 獨特能力、使用者吸引力)的 agent 平行發想後交集統整為 10 項;本項被三視角同時命中,是最強的需求訊號。',
    },
    {
      heading: '做什麼',
      paragraphs: ['把 IG/小紅書/YouTube/部落格連結、截圖、朋友 LINE 訊息、甚至研討會議程整段貼進來,AI 抽出裡面的地點/場次、比對成 Google Places 真實地標,收進候選池並建議可插入的日子時段。'],
    },
    {
      heading: '取代的繁瑣流程',
      paragraphs: ['相簿裡幾十張美食截圖、瀏覽器一堆書籤,排程時一張張回看、手動搜地名、複製到備忘錄再抄進行程。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['一般 AI 行程產生器憑空生出罐頭行程;把「你自己收藏的東西」變成行程,第一分鐘就是「這是我的行程」而不是「AI 的行程」。'],
    },
    {
      heading: 'AI 角色',
      paragraphs: ['核心——從雜亂自由文本/截圖抽實體、消歧義(哪家分店)、判斷塞哪裡合理。多模態 LLM + Places Text Search。'],
    },
    {
      heading: '可行性',
      paragraphs: ['LLM 抽取 + Places 比對(已接)可跑通;IG/小紅書反爬,走截圖路線比抓連結內文穩。'],
      note: '同名地點解析錯誤會把人導去錯的店,結果必須讓使用者確認。',
    },
    {
      heading: '延伸',
      paragraphs: ['研討會場景(貼議程 → 個人課表 + 衝堂偵測)用同一套機制。'],
    },
    {
      heading: '與其他項目的關係',
      paragraphs: ['候選池與構想 6(旅伴共決,見構想 6(/ideas/product-feature-6-companion-voting))共用。'],
    },
  ],
  tags: ['功能腦力激盪', '候選池', 'Places', '三視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
