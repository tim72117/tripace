// controlsPlacement 契約測試——規則見 controlsPlacement.ts 檔頭。
import { describe, it, expect } from 'vitest'
import { resolveControlsPlacement } from './controlsPlacement'

describe('resolveControlsPlacement', () => {
  it('undefined(沒有指定 UI 層)= 原地渲染,桌面版與既有呼叫端行為不變', () => {
    expect(resolveControlsPlacement(undefined)).toBe('inline')
  })

  it('null(指定要用 UI 層但容器還沒掛載)= 先不渲染,避免控制項先閃現在地圖內再跳走', () => {
    expect(resolveControlsPlacement(null)).toBe('hidden')
  })

  it('有容器元素 = 傳送到該容器', () => {
    const el = document.createElement('div')
    expect(resolveControlsPlacement(el)).toBe('portal')
  })
})
