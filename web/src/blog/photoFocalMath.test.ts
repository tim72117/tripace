import { describe, it, expect } from 'vitest'
import {
  clamp01,
  pointFromPointerEvent,
  objectPositionFor,
  photoDisplayStatus,
  canEditFocal,
  cropBoxGeometry,
  focalFromCropOffset,
  cropOffsetFromFocal,
  offsetFromPointerEvent,
  TARGET_CROP_RATIO,
} from './photoFocalMath'

// 這份測試只涵蓋純計算邏輯(座標換算、狀態判斷),不測試
// PhotoManagerPage.tsx/PhotoFocalEditor.tsx 的 JSX 渲染——對齊
// scrollTimelineGrouping.test.ts 「只測純函式」的既有做法。

describe('clamp01', () => {
  it('範圍內的值原封不動回傳', () => {
    expect(clamp01(0.42)).toBe(0.42)
  })
  it('小於 0 時夾到 0', () => {
    expect(clamp01(-0.1)).toBe(0)
  })
  it('大於 1 時夾到 1', () => {
    expect(clamp01(1.3)).toBe(1)
  })
  it('NaN 視為 0', () => {
    expect(clamp01(NaN)).toBe(0)
  })
})

describe('pointFromPointerEvent', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('容器左上角對應 (0, 0)', () => {
    expect(pointFromPointerEvent(100, 50, rect)).toEqual({ x: 0, y: 0 })
  })

  it('容器正中央對應 (0.5, 0.5)', () => {
    expect(pointFromPointerEvent(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('容器右下角對應 (1, 1)', () => {
    expect(pointFromPointerEvent(300, 150, rect)).toEqual({ x: 1, y: 1 })
  })

  it('拖曳超出容器邊界時 clamp 在 0~1 之間', () => {
    expect(pointFromPointerEvent(-50, -50, rect)).toEqual({ x: 0, y: 0 })
    expect(pointFromPointerEvent(1000, 1000, rect)).toEqual({ x: 1, y: 1 })
  })

  it('容器尺寸為 0 時退回置中,避免除以 0', () => {
    expect(pointFromPointerEvent(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })
})

describe('objectPositionFor', () => {
  it('沒有焦點時回傳 undefined', () => {
    expect(objectPositionFor(undefined)).toBeUndefined()
  })
  it('依公式轉成百分比字串', () => {
    expect(objectPositionFor({ x: 0.25, y: 0.75 })).toBe('25% 75%')
  })
  it('置中焦點轉成 50% 50%', () => {
    expect(objectPositionFor({ x: 0.5, y: 0.5 })).toBe('50% 50%')
  })
})

describe('photoDisplayStatus', () => {
  it('ready 原樣回傳', () => {
    expect(photoDisplayStatus('ready')).toBe('ready')
  })
  it('failed 原樣回傳', () => {
    expect(photoDisplayStatus('failed')).toBe('failed')
  })
  it('pending 原樣回傳', () => {
    expect(photoDisplayStatus('pending')).toBe('pending')
  })
  it('未知字串保守視為 pending', () => {
    expect(photoDisplayStatus('whatever')).toBe('pending')
  })
})

describe('canEditFocal', () => {
  it('只有 ready 狀態允許編輯焦點', () => {
    expect(canEditFocal('ready')).toBe(true)
    expect(canEditFocal('pending')).toBe(false)
    expect(canEditFocal('failed')).toBe(false)
    expect(canEditFocal('unknown')).toBe(false)
  })
})

describe('cropBoxGeometry', () => {
  // 目標比例依原圖本身是橫式(ratio>=1)還是直式(ratio<1)鏡像對調——
  // 橫式原圖用 TARGET_CROP_RATIO:1(1.5:1),直式原圖用鏡像的
  // 1:TARGET_CROP_RATIO(即 0.667:1),讓兩種方向的原圖都能得到一個
  // 「同方向」的裁切框,而不是全部套用同一個橫式框。

  it('原圖比例剛好等於橫式目標比例(1.5:1)時,框貼合整張原圖,無法拖動', () => {
    expect(cropBoxGeometry(TARGET_CROP_RATIO)).toEqual({
      widthRatio: 1,
      heightRatio: 1,
      dragAxis: 'none',
    })
  })

  it('原圖比例剛好等於直式目標比例(1:1.5)時,框貼合整張原圖,無法拖動', () => {
    expect(cropBoxGeometry(1 / TARGET_CROP_RATIO)).toEqual({
      widthRatio: 1,
      heightRatio: 1,
      dragAxis: 'none',
    })
  })

  it('橫式原圖,比橫式目標更寬(例如全景照)——框貼齊原圖高度,沿水平拖動', () => {
    // imageAspectRatio = 3(很寬的全景照)
    const g = cropBoxGeometry(3)
    expect(g.heightRatio).toBe(1)
    expect(g.widthRatio).toBeCloseTo(0.5, 5) // 1.5 / 3
    expect(g.dragAxis).toBe('x')
  })

  it('橫式原圖,比橫式目標更窄(接近正方形的橫幅)——框貼齊原圖寬度,沿垂直拖動', () => {
    // imageAspectRatio = 1.2(介於正方形與 1.5:1 之間,仍判定為橫式)
    const g = cropBoxGeometry(1.2)
    expect(g.widthRatio).toBe(1)
    expect(g.heightRatio).toBeCloseTo(0.8, 5) // 1.2 / 1.5
    expect(g.dragAxis).toBe('y')
  })

  it('典型相機橫拍 16:9——框貼齊原圖高度,沿水平拖動', () => {
    const g = cropBoxGeometry(16 / 9)
    expect(g.heightRatio).toBe(1)
    expect(g.widthRatio).toBeCloseTo((1.5 * 9) / 16, 5)
    expect(g.dragAxis).toBe('x')
  })

  it('直式原圖,比直式目標更窄更長(典型手機直拍 9:16)——框貼齊原圖寬度,沿垂直拖動', () => {
    const g = cropBoxGeometry(9 / 16)
    expect(g.widthRatio).toBe(1)
    expect(g.heightRatio).toBeCloseTo((9 / 16) / (1 / TARGET_CROP_RATIO), 5)
    expect(g.dragAxis).toBe('y')
  })

  it('直式原圖,比直式目標更寬(接近正方形的直幅,如 3:4 人像照)——框貼齊原圖高度,沿水平拖動', () => {
    // imageAspectRatio = 0.75(3:4),直式目標 1/1.5≈0.667,0.75 > 0.667
    // ——原圖沒有目標框那麼窄長,框要縮窄去符合更窄的目標比例。
    const g = cropBoxGeometry(0.75)
    expect(g.heightRatio).toBe(1)
    expect(g.widthRatio).toBeCloseTo((1 / TARGET_CROP_RATIO) / 0.75, 5)
    expect(g.dragAxis).toBe('x')
  })

  it('正方形原圖(1:1,視為橫式分支因為 ratio>=1)——框貼齊寬度,沿垂直拖動', () => {
    const g = cropBoxGeometry(1)
    expect(g.widthRatio).toBe(1)
    expect(g.heightRatio).toBeCloseTo(1 / TARGET_CROP_RATIO, 5)
    expect(g.dragAxis).toBe('y')
  })

  it('非正數或非有限值時退回 1:1 無法拖動,避免除以 0/NaN', () => {
    expect(cropBoxGeometry(0)).toEqual({ widthRatio: 1, heightRatio: 1, dragAxis: 'none' })
    expect(cropBoxGeometry(-1)).toEqual({ widthRatio: 1, heightRatio: 1, dragAxis: 'none' })
    expect(cropBoxGeometry(NaN)).toEqual({ widthRatio: 1, heightRatio: 1, dragAxis: 'none' })
    expect(cropBoxGeometry(Infinity)).toEqual({ widthRatio: 1, heightRatio: 1, dragAxis: 'none' })
  })
})

describe('focalFromCropOffset / cropOffsetFromFocal(互為反函式)', () => {
  it('dragAxis 為 x 時,offset=0 對應框貼最左,offset=1 對應框貼最右,y 固定置中', () => {
    const g = cropBoxGeometry(3) // widthRatio = 0.5, dragAxis = 'x'
    expect(focalFromCropOffset(g, 0)).toEqual({ x: 0.25, y: 0.5 })
    expect(focalFromCropOffset(g, 1)).toEqual({ x: 0.75, y: 0.5 })
    expect(focalFromCropOffset(g, 0.5)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('dragAxis 為 y 時,offset=0 對應框貼最上,offset=1 對應框貼最下,x 固定置中', () => {
    const g = cropBoxGeometry(9 / 16) // 典型手機直拍,dragAxis = 'y'
    expect(g.dragAxis).toBe('y')
    const top = focalFromCropOffset(g, 0)
    const bottom = focalFromCropOffset(g, 1)
    expect(top.x).toBe(0.5)
    expect(bottom.x).toBe(0.5)
    expect(top.y).toBeLessThan(0.5)
    expect(bottom.y).toBeGreaterThan(0.5)
  })

  it('dragAxis 為 none 時永遠回傳置中焦點', () => {
    const g = cropBoxGeometry(TARGET_CROP_RATIO)
    expect(focalFromCropOffset(g, 0)).toEqual({ x: 0.5, y: 0.5 })
    expect(focalFromCropOffset(g, 1)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('cropOffsetFromFocal 是 focalFromCropOffset 的反函式(x 軸)', () => {
    const g = cropBoxGeometry(3)
    for (const offset of [0, 0.25, 0.5, 0.75, 1]) {
      const focal = focalFromCropOffset(g, offset)
      expect(cropOffsetFromFocal(g, focal)).toBeCloseTo(offset, 10)
    }
  })

  it('cropOffsetFromFocal 是 focalFromCropOffset 的反函式(y 軸)', () => {
    const g = cropBoxGeometry(9 / 16)
    expect(g.dragAxis).toBe('y')
    for (const offset of [0, 0.25, 0.5, 0.75, 1]) {
      const focal = focalFromCropOffset(g, offset)
      expect(cropOffsetFromFocal(g, focal)).toBeCloseTo(offset, 10)
    }
  })

  it('offset 超出 0~1 範圍時 clamp,不會讓焦點跑出原圖', () => {
    const g = cropBoxGeometry(3)
    expect(focalFromCropOffset(g, -0.5)).toEqual(focalFromCropOffset(g, 0))
    expect(focalFromCropOffset(g, 1.5)).toEqual(focalFromCropOffset(g, 1))
  })
})

describe('offsetFromPointerEvent', () => {
  it('軌道起點對應 offset 0,終點對應 offset 1', () => {
    const track = { start: 100, length: 200 }
    expect(offsetFromPointerEvent(100, track)).toBe(0)
    expect(offsetFromPointerEvent(300, track)).toBe(1)
    expect(offsetFromPointerEvent(200, track)).toBe(0.5)
  })

  it('超出軌道範圍時 clamp 在 0~1 之間', () => {
    const track = { start: 100, length: 200 }
    expect(offsetFromPointerEvent(0, track)).toBe(0)
    expect(offsetFromPointerEvent(1000, track)).toBe(1)
  })

  it('軌道長度為 0(無法拖動)時退回置中,避免除以 0', () => {
    expect(offsetFromPointerEvent(50, { start: 100, length: 0 })).toBe(0.5)
  })
})
