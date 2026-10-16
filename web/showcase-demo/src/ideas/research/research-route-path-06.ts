import type { IdeaDoc } from '../types'

export const RESEARCH_ROUTE_PATH_06: IdeaDoc = {
  id: 'research-route-path-06',
  group: 'research',
  order: 35,
  title: '路徑機制・場景二:沿途主題點的呈現(地圖為版面骨架)',
  summary: '套用路徑後以大地圖為主角,線上浮著圓形照片縮圖徽章,點進去才展開完整卡片。',
  sections: [
    {
      heading: '場景描繪',
      paragraphs: [
        '套用路徑後,畫面主體換成一張大地圖,那條路徑線沿著畫面斜切而過,像一條緞帶。線上每隔一段距離浮著一個圓形縮圖徽章(不是普通的 pin 圖釘,是裁成圓形、帶白色邊框的小照片縮圖,像 Google 地圖「熱門景點」標記的質感),點進去才展開成完整卡片。',
      ],
    },
    {
      heading: '版面選擇的理由',
      paragraphs: [
        '這個版面選擇是刻意的:地圖是主角,照片是點綴在路徑上的「預告」,使用者的視線動線是先看到整條路的形狀,再被某個縮圖吸引去點開細看——而不是先看一排密密麻麻的文字清單。',
      ],
    },
  ],
  tags: ['路徑', '前端', '地圖', '場景'],
  source: ['docs/research-route-path-planning-2026-10.md'],
}
