import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_03: IdeaDoc = {
  id: 'research-storytelling-03',
  group: 'research',
  order: 3,
  title: '點子 3:古今對照滑桿(歷史影像疊層)',
  summary: '介紹卡照片區改成左右拖曳滑桿,左為古照、右為今日同角度,限旗艦主題點。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: [
        '公版歷史照片——Wikimedia Commons、日本國立國會圖書館數位典藏、台灣「國家文化記憶庫」多為 PD 或 CC 授權;需逐張確認授權與拍攝視角是否對得上今照。成本在「找到視角相近的古今照片對」的人工策展,非每個點都有,適合旗艦主題點限定(一開始 10–20 個點就夠成立)。',
      ],
    },
    {
      heading: '如何介紹',
      paragraphs: [
        '介紹卡照片區變成左右拖曳滑桿:左 1910 年代黑白街景、右今日同角度。附一行圖說(年代+出處)。',
      ],
    },
    {
      heading: '如何引導',
      paragraphs: [
        '有古照的點,照片角落浮一枚「1910 ↔ 今」小標記暗示可拖;拖過一次後出現一句「這條坡道一百年沒變的是⋯」接回敘事層(點子 1)。',
      ],
    },
    {
      heading: '增強使用者感受',
      paragraphs: [
        '解決「看照片沒感覺、到了現場沒有時間縱深」。滑桿是身體性互動,「原來百年前就長這樣」的瞬間是可分享的記憶點。',
      ],
    },
  ],
  verdict: '可行性/優先度:中。體驗衝擊力大但內容供給是瓶頸,適合當「旗艦點限定」的差異化亮點,不追求覆蓋率。已做 artifact(示意互動)。',
  tags: ['景點介紹', '歷史影像', '旗艦點限定'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
