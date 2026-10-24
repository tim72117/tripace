import type { IdeaDoc } from '../types'

export const FEATURE_4: IdeaDoc = {
  id: 'product-feature-4-transit-autofill',
  group: 'product',
  order: 43,
  title: '功能構想 4:接駁自動補齊(交通是一等公民)',
  summary: '在景點之間自動補上搭哪班車、多久、約多少錢,依情境選交通方式,並在末班車趕不上、假日停駛等斷點主動警示。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['景點「之間」自動補上:搭哪班車、多久、約多少錢,依情境選交通方式(拖行李 → 計程車、有 JR Pass → 優先 JR),在斷點(末班車趕不上、假日停駛)主動警示。'],
    },
    {
      heading: '取代的繁瑣流程',
      paragraphs: ['自己開地圖一段段查 A→B 幾分鐘、有沒有末班車,行程一改全部重查。'],
    },
    {
      heading: '為什麼非 AI 不可',
      paragraphs: ['導航 App 只回答「現在從 A 到 B」,不懂你的脈絡;規劃期的交通推理(考慮行李、票券、時段)是 AI 的事。'],
    },
    {
      heading: '可行性',
      paragraphs: [
        'Google Routes/Directions API(含大眾運輸班次)直接可做;難點是呼叫成本(需快取、只算相鄰段)與海外運輸資料品質。',
        '這也是「地理理解」呈現(時間軸相鄰點的距離與移動時間)的資料基礎。',
      ],
    },
  ],
  tags: ['功能腦力激盪', '交通', 'Routes API'],
  source: ['docs/feature-brainstorm.md'],
}
