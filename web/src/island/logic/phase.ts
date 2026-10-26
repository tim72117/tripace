// phase.ts——時間 → 傍晚到夜晚的時段名稱(純函式,HUD 顯示用)。
export function phaseName(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  if (m < 6 * 60 || m >= 21 * 60 + 30) return '深夜'
  if (m < 16 * 60) return '白天'
  if (m < 17 * 60 + 15) return '午後'
  if (m < 18 * 60 + 15) return '夕陽'
  if (m < 19 * 60 + 15) return '藍調時刻'
  return '夜晚'
}
