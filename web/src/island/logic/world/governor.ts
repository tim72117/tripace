// governor.ts——效能調節器(純函式,做法同 WoC render_budget):量測每幀時間,持續太慢就降一級,持續有餘裕才升一級。
//
// 等級由呼叫端定義(例如像素密度 [1, 1.25, 1.5, 2]),這裡只決定「現在該用第幾級」。
//   - 每幀時間用指數移動平均(EMA)平滑,單幀卡頓不會觸發
//   - 降級:平均超過 targetMs × downRatio 持續 holdS 秒;升級:平均低於 targetMs × upRatio 持續 holdS × 2 秒(升級要更謹慎)
//   - 切換後冷卻 cooldownS 秒才再評估,避免來回跳
export type GovernorCfg = { targetMs: number; downRatio: number; upRatio: number; holdS: number; cooldownS: number; levels: number }
export type GovernorState = { level: number; emaMs: number; overS: number; underS: number; cooldownS: number }

export const DEFAULT_GOVERNOR: Omit<GovernorCfg, 'levels'> = { targetMs: 1000 / 50, downRatio: 1.15, upRatio: 0.7, holdS: 1.5, cooldownS: 3 }

export function initGovernor(level: number): GovernorState {
  return { level, emaMs: 0, overS: 0, underS: 0, cooldownS: 0 }
}

export function stepGovernor(s: GovernorState, dtS: number, cfg: GovernorCfg): GovernorState {
  const ms = dtS * 1000
  const emaMs = s.emaMs === 0 ? ms : s.emaMs + (ms - s.emaMs) * 0.08
  if (s.cooldownS > 0) return { ...s, emaMs, cooldownS: Math.max(0, s.cooldownS - dtS) }
  const overS = emaMs > cfg.targetMs * cfg.downRatio ? s.overS + dtS : 0
  const underS = emaMs < cfg.targetMs * cfg.upRatio ? s.underS + dtS : 0
  if (overS >= cfg.holdS && s.level > 0) return { level: s.level - 1, emaMs, overS: 0, underS: 0, cooldownS: cfg.cooldownS }
  if (underS >= cfg.holdS * 2 && s.level < cfg.levels - 1) return { level: s.level + 1, emaMs, overS: 0, underS: 0, cooldownS: cfg.cooldownS }
  return { level: s.level, emaMs, overS, underS, cooldownS: 0 }
}
