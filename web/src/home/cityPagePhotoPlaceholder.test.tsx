// 城市頁(京都/九份/台南安平)站點照片的站位:每張 <img> 都帶照片原始寬高(width/height 屬性),
// 讓瀏覽器在下載前就依比例預留高度(修正前外框從 0 撐開,京都第一張 0→630px、CLS 0.072);
// 載入完成標 data-loaded,CSS 才拿掉淡色佔位底。
//
// 京都、九份每一站都有照片:每個外框都必須有 img。台南有些站沒有照片,那些外框改走色塊佔位
// (.tainan-stop-photo-label,aspect-ratio 撐高)——「外框沒有 img」只對台南放行,而且要確認它真的換成色塊佔位。
import type { ComponentType } from 'react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'

// 互動地圖需要 Google Maps,與這份測試無關,換成空殼。
vi.mock('./InteractiveExploreMap', () => ({ InteractiveExploreMap: () => null }))

// jsdom 沒有 IntersectionObserver(ScrollTimeline 會用到):測試期間補一個空實作,結束後還原原狀(原本沒有就刪掉),
// 不讓這個假實作洩漏到同一個 worker 的其他測試檔。
const win = window as unknown as { IntersectionObserver?: unknown }
const hadIO = 'IntersectionObserver' in window
const originalIO = win.IntersectionObserver
beforeAll(() => {
  if (!hadIO) {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
    win.IntersectionObserver = IO
  }
})
afterAll(() => {
  if (hadIO) win.IntersectionObserver = originalIO
  else delete win.IntersectionObserver
})

async function renderPage(load: () => Promise<Record<string, ComponentType>>, name: string) {
  const mod = await load()
  const Page = mod[name]
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

type PageCase = [name: string, load: () => Promise<Record<string, ComponentType>>, frameSel: string, photoless: string | null]

describe.each<PageCase>([
  ['KyotoPage', () => import('./KyotoPage') as unknown as Promise<Record<string, ComponentType>>, '.kyoto-stop-photo', null],
  ['JiufenPage', () => import('./JiufenPage') as unknown as Promise<Record<string, ComponentType>>, '.jiufen-stop-photo', null],
  // 台南:沒有照片的站以 .tainan-stop-photo-label 色塊佔位
  ['TainanPage', () => import('./TainanPage') as unknown as Promise<Record<string, ComponentType>>, '.tainan-stop-photo', '.tainan-stop-photo-label'],
])('%s 站點照片站位', (name, load, frameSel, photolessSel) => {
  it(
    photolessSel
      ? '有照片的外框:img 帶正整數 width/height;沒照片的外框:改走色塊佔位(只有台南允許)'
      : '每個外框都有 img,且帶正整數 width/height',
    async () => {
      const { container } = await renderPage(load, name)
      const frames = Array.from(container.querySelectorAll(frameSel))
      expect(frames.length).toBeGreaterThan(0)
      let withImg = 0
      for (const frame of frames) {
        const imgs = frame.querySelectorAll('img')
        if (imgs.length === 0) {
          // 只有台南放行,且必須是色塊佔位(有站名文字),不是空外框
          expect(photolessSel, `${name} 的外框沒有 img`).not.toBeNull()
          const label = frame.querySelector(photolessSel!)
          expect(label, `${name} 沒照片的外框沒有色塊佔位`).not.toBeNull()
          expect((label!.textContent ?? '').trim()).not.toBe('')
          continue
        }
        expect(imgs).toHaveLength(1)
        const img = imgs[0]
        withImg += 1
        expect(Number.isInteger(Number(img.getAttribute('width')))).toBe(true)
        expect(Number(img.getAttribute('width'))).toBeGreaterThan(0)
        expect(Number.isInteger(Number(img.getAttribute('height')))).toBe(true)
        expect(Number(img.getAttribute('height'))).toBeGreaterThan(0)
        // 有照片的外框不該同時畫色塊佔位
        if (photolessSel) expect(frame.querySelector(photolessSel)).toBeNull()
      }
      // 有照片的站至少一個(台南也不是全都沒照片)
      expect(withImg).toBeGreaterThan(0)
      if (!photolessSel) expect(withImg).toBe(frames.length)
    },
  )

  it('載入完成標 data-loaded(拿掉佔位底的依據):逐張驗,只有觸發 load 的那張被標記', async () => {
    const { container } = await renderPage(load, name)
    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>(`${frameSel} img`))
    expect(imgs.length).toBeGreaterThan(0)
    for (const img of imgs) expect(img.dataset.loaded).toBeUndefined()
    imgs.forEach((img, i) => {
      fireEvent.load(img)
      expect(img.dataset.loaded).toBe('true')
      // 還沒載入的那些仍未標記(標記不是整頁一起打開)
      for (const rest of imgs.slice(i + 1)) expect(rest.dataset.loaded).toBeUndefined()
    })
  })
})
