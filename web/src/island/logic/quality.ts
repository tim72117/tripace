// quality.ts——品質等級偵測與各等級的設定(純函式,不依賴瀏覽器物件,輸入都由呼叫端傳入)。
//
// 網址參數 ?q=low|mid|high 優先;沒有時依螢幕寬度、是否觸控為主、CPU 核心數粗略判斷。
// 原型沒有實機量測,門檻是經驗值(見 docs/implementation-plan.md 第 8 章,「未在實機驗證」)。
export type Quality = 'low' | 'mid' | 'high'

export type QualityCfg = {
  pixelRatioMax: number
  shadowSize: number // 0 = 關閉陰影
  stars: number
  particleScale: number // 0..1,乘上各粒子數量
  pointLights: number
  glowSize: number
}

export function detectQuality(search: string, env: { width: number; coarsePointer: boolean; cores: number }): Quality {
  const forced = new URLSearchParams(search).get('q')
  if (forced === 'low' || forced === 'mid' || forced === 'high') return forced
  if (env.coarsePointer || env.width < 700) return env.cores >= 8 ? 'mid' : 'low'
  return env.cores >= 6 ? 'high' : 'mid'
}

export function configFor(q: Quality): QualityCfg {
  switch (q) {
    case 'high': return { pixelRatioMax: 2, shadowSize: 2048, stars: 600, particleScale: 1, pointLights: 4, glowSize: 3.4 }
    case 'mid': return { pixelRatioMax: 1.5, shadowSize: 1024, stars: 300, particleScale: 0.6, pointLights: 4, glowSize: 3.2 }
    case 'low': return { pixelRatioMax: 1, shadowSize: 0, stars: 120, particleScale: 0.3, pointLights: 2, glowSize: 3 }
  }
}
