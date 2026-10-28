// 夜遊九份島——輕量描述(同步)。重資料在 ./data.ts,進場景才動態載入。
// seo 的 title/description 必須跟伺服器 server/cmd/server/seo_meta.go 的 "/island" 逐字相同,
// scenes/seo.test.ts 會直接讀那個檔案比對。
import type { SceneDef } from '../types'

export const NIGHT_JIUFEN: SceneDef = {
  id: 'night-jiufen',
  label: '夜遊九份',
  pageLabel: '夜遊九份島',
  ctaLabel: '用 Tripace 排我的九份',
  seo: {
    title: '夜遊九份島——把一篇遊記變成一座會亮燈的島 | Tripace',
    description:
      '傍晚上山，看九份的紅燈籠沿著石階一盞一盞亮起。這是依據部落客遊記〈夜遊九份〉做成的低多邊形小島，可以旋轉、拖動時間、逐站閱讀，並下載附署名的分享圖。',
  },
  load: async () => (await import('./data')).default,
}
