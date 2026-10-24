import type { IdeaDoc } from '../types'

export const RESEARCH_COMPANION_03: IdeaDoc = {
  id: 'research-companion-03',
  group: 'research',
  order: 42,
  title: '旅伴應徵配對:配對流程與初版不做的事',
  summary: '初版為一對一流程:發布應徵、瀏覽、申請、接受、開聊天室;明確排除合併行程、團體配對與推薦演算法。',
  sections: [
    {
      heading: '初版流程(先做,之後可再擴充)',
      bullets: [
        '使用者 A 發布應徵(路徑 + 條件)',
        '使用者 B 瀏覽配對池,看到 A 的應徵',
        'B 提出配對申請(或直接應徵,具體互動待設計)',
        'A 確認接受',
        '開啟一對一聊天室',
        '雙方自行談後續(要不要一起出發、行程怎麼分配等),系統不介入,不自動合併成共享 Trip',
      ],
    },
    {
      heading: '初版不做的事(先明確排除,避免範圍蔓延)',
      bullets: [
        '不自動把配對雙方的行程合併成同一個共享 Trip——聊天室談完要不要共用行程規劃工具,是雙方自己的決定,不是系統自動化的一步。',
        '不做多人團體配對(先只做一對一),團體揪團是否需要屬於範圍待定的擴充項。',
        '不做配對演算法/推薦排序(先做「條件篩選 + 瀏覽」,不是「系統幫你推薦最適合的人」)。',
      ],
    },
  ],
  tags: ['旅伴配對', '流程', '範圍'],
  source: ['docs/research-travel-companion-matching-2026-08.md'],
}
