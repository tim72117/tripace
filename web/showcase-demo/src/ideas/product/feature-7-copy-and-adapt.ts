import type { IdeaDoc } from '../types'

export const FEATURE_7: IdeaDoc = {
  id: 'product-feature-7-copy-and-adapt',
  group: 'product',
  order: 46,
  title: '功能構想 7:一鍵複製 + AI 改編',
  summary: '看到別人公開分享的行程按「複製成我的」,再對 AI 說「我們只有四天、帶兩個小孩」自動改編成自己的版本;形成獲客迴圈,幾乎是白拿的功能。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['看到別人公開分享的行程按「複製成我的」,選好日期人數後對 AI 說「我們只有四天、帶兩個小孩」,自動改編成自己的版本。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['複製完只能手動慢慢改(Wanderlog 現況)vs「別人的五天行程一句話變成我的四天親子版」——新使用者第一分鐘拿到八成完成度;每個分享出去的行程變成會繁殖的資產,形成獲客迴圈。'],
    },
    {
      heading: '可行性',
      paragraphs: ['公開分享機制已存在,AI 改編就是現有對話規劃的一個預設 prompt,幾乎是白拿的功能。'],
    },
  ],
  tags: ['功能腦力激盪', '獲客', '分享'],
  source: ['docs/feature-brainstorm.md'],
}
