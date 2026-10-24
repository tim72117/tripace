import type { IdeaDoc } from '../types'

export const RESEARCH_ROUTE_PATH_09: IdeaDoc = {
  id: 'research-route-path-09',
  group: 'research',
  order: 38,
  title: '路徑機制:雛形限制與後續',
  summary: '目前只是純構想文案,沒有可互動雛形;資料結構與 UI 元件尚未落地,待篩選後再決定是否推進。',
  sections: [
    {
      heading: '雛形限制',
      paragraphs: [
        '這份是純構想文案,沒有可運作的假資料互動(不像構想一/三那樣有卡片牆或面板可以點)。',
      ],
      bullets: [
        '資料結構草案(RoutePath/RouteThemePoint)尚未真正落地成型別檔案或後端 schema。',
        '「照片呈現兩種可能性」目前只有文字描繪,尚未做出對應的 UI 元件雛形。',
      ],
    },
    {
      heading: '後續',
      paragraphs: [
        '這些留待使用者篩選這份構想要不要往下推進後,再決定是否值得投入做出真正可互動的雛形(對齊既有雛形頁面如構想一/三的程度)。',
      ],
    },
  ],
  tags: ['路徑', '雛形限制'],
  source: ['docs/research-route-path-planning-2026-10.md'],
}
