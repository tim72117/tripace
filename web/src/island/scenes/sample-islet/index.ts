// 範例小島(實驗場景,feature flag VITE_FEATURE_ISLAND_SAMPLE=true 才登記)——用來驗證「引擎不綁特定場景」與場景切換流程:平地、白天、三站,全部用共用模型,
// 沒有階地、斜坡與專屬模型。不進 sitemap、不對外(experimental);要正式新增場景請照 scenes/README 的步驟另建目錄。
import type { SceneDef } from '../types'

export const SAMPLE_ISLET: SceneDef = {
  id: 'sample-islet',
  label: '範例小島',
  pageLabel: '範例小島',
  ctaLabel: '用 Tripace 排我的小島行程',
  seo: { title: '範例小島 | Tripace', description: '開發用的範例場景,用來驗證場景切換。' },
  experimental: true,
  load: async () => (await import('./data')).default,
}
