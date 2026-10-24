import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_07: IdeaDoc = {
  id: 'research-storytelling-07',
  group: 'research',
  order: 7,
  title: '點子 7:現場任務章(到場才解鎖的觀察任務)',
  summary: '人工策展只有到現場才驗證得了的觀察任務,到場解鎖蓋章,行程結束彙整成旅程印帖。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: [
        '人工策展「只有到現場才驗證得了的細節」任務(音羽瀑布三道水各代表什麼?弁慶的鐵下駄在哪?),每個主題點 3–5 條,一次性建檔成本可控;搭配抵達判定(定位進入 radiusMeters 即可,不需 GPS 精準打卡)。',
      ],
    },
    {
      heading: '如何介紹',
      paragraphs: ['任務卡清單+完成蓋「御朱印」風格印章;集章頁面按行程彙整,行程結束變成一頁旅程印帖。'],
    },
    {
      heading: '如何引導',
      paragraphs: ['行前介紹卡只露任務標題吊胃口(「到了現場找找看」);行程當天人到範圍內任務解鎖可蓋章。與既有「加入行程」狀態銜接——排進行程的點才推任務。'],
    },
    {
      heading: '增強使用者感受',
      paragraphs: ['解決「到了現場只是拍照就走、看完就忘」。任務把介紹內容轉成現場行為,印帖把行為轉成行後記憶,補齊「行前—現場—行後」最弱的兩環。'],
    },
  ],
  verdict: '可行性/優先度:中高(第三優先)。內容成本低、與行程狀態機天然整合,且是十個點子中唯一同時覆蓋現場與行後的。已做 artifact。',
  tags: ['景點介紹', '遊戲化', '第三優先'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
