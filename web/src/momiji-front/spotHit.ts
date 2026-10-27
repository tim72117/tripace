// spotHit.ts——地圖點擊命中判斷(純函式)。
//
// 楓葉層是 pointer-events:none 的 canvas(地圖照常拖曳縮放),所以景點徽章本身
// 收不到點擊;改成監聽地圖的 click,把「點到的位置」與「每個可點景點的螢幕位置」
// 都換成容器像素,找命中的最近一個。換算(經緯度→像素)在頁面裡用 overlay 的
// projection 做,這裡只處理幾何,方便單獨測試。
//
// 可點區域是「徽章圓形(半徑內)」加上「名稱文字的矩形」:使用者會直接點文字,
// 不只徽章。

// 景點名稱的繪製參數——畫(momijiRenderer.drawSpots)與點(頁面量文字寬度、
// 這裡的命中矩形)必須是同一組,放在這裡當唯一來源,避免日後改了字型或位移,
// 畫出來的位置和能點的位置悄悄不一致。
export const SPOT_LABEL_FONT = '700 12px -apple-system, "Hiragino Sans", "PingFang TC", sans-serif'
// 文字左緣相對徽章中心的水平位移(徽章半徑 9 + 間距)。
export const SPOT_LABEL_OFFSET_X = 13
// 文字可點區域的上下半高:字高 12px 加描邊,取 10 讓手指好點。
export const SPOT_LABEL_HALF_HEIGHT = 10
// 文字可點區域左右各多留的像素。
export const SPOT_LABEL_PAD_X = 4

export interface PxPoint {
  id: string
  x: number
  y: number
  // labelWidth——名稱文字的寬度(像素)。有值時,文字矩形也算命中;省略就只有
  // 圓形範圍(沒有文字的點)。
  labelWidth?: number
}

// nearestWithin——回傳命中 (x, y) 的最近一個點的 id;沒有則 null。命中 = 距離徽章
// 中心 radius 像素以內,或落在名稱文字矩形內。多個都命中時取「距離自己的錨點
// (圓形用徽章中心、文字用文字中心)最近」的;距離相同時取清單中較前面的。
export function nearestWithin(points: ReadonlyArray<PxPoint>, x: number, y: number, radius: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const p of points) {
    let d = Infinity
    const dc = (p.x - x) ** 2 + (p.y - y) ** 2
    if (dc <= radius * radius) d = dc
    if (p.labelWidth !== undefined) {
      const left = p.x + SPOT_LABEL_OFFSET_X - SPOT_LABEL_PAD_X
      const right = p.x + SPOT_LABEL_OFFSET_X + p.labelWidth + SPOT_LABEL_PAD_X
      if (x >= left && x <= right && Math.abs(y - p.y) <= SPOT_LABEL_HALF_HEIGHT) {
        const dl = ((left + right) / 2 - x) ** 2 + (p.y - y) ** 2
        if (dl < d) d = dl
      }
    }
    if (d !== Infinity && (best === null || d < bestD)) {
      best = p.id
      bestD = d
    }
  }
  return best
}
