// PhotoCarousel:GeoInfoPanel.tsx 照片顯示區域的抽出元件——驗證
// 0/1/多張三種張數的顯示分支,以及桌面版(點擊縮圖開 Lightbox)、手機版
// (橫向並排滑動列)兩套完全不同的互動模式(見該元件開頭的說明)。
//
// mockMatchMedia:jsdom 沒有實作 window.matchMedia,useIsDesktop(見
// hooks/useIsDesktop.ts)直接呼叫它會拋出 TypeError,故每個測試都要先
// 用這個 helper 安裝一個回傳固定 matches 值的假實作,依測試情境切換
// 桌面/手機分支。不驗證觸控滑動/scroll-snap 的實際像素位移(jsdom 對
// scrollLeft/IntersectionObserver 的支援有限),只驗證兩種模式該渲染
// 出的元素是否正確、桌面版的互動(開關 Lightbox、左右切換)是否正確。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhotoCarousel } from './PhotoCarousel'

function mockMatchMedia(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

// jsdom 沒有實作 IntersectionObserver(MobileSwipeStrip 用它偵測目前
// 捲動到哪一張,見 PhotoCarousel.tsx 的說明)——測試不驗證實際交集比例
// 計算(那需要真實瀏覽器的版面配置),只需要元件掛載時不會因為呼叫不存在
// 的建構子而拋錯,故給一個最小可用的假實作。
class FakeIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

afterEach(() => {
  vi.restoreAllMocks()
})

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

describe('PhotoCarousel — 0/1 張圖(桌面/手機共用同一種顯示,不受裝置影響)', () => {
  it('沒有任何照片來源、也沒有 fallbackUrl 時,顯示 placeholder,不顯示 <img>', () => {
    mockMatchMedia(true)
    const { container } = render(<PhotoCarousel alt="測試地點" />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('googlePhotoUrls/pexelsPhotoUrls 皆空但有 fallbackUrl 時,顯示 fallbackUrl 這張圖,不顯示任何互動控制項', () => {
    mockMatchMedia(false)
    render(<PhotoCarousel alt="測試地點" fallbackUrl="https://example.com/fallback.jpg" />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/fallback.jpg')
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('只有 1 張圖(googlePhotoUrls 單一項目)時,直接顯示,不顯示任何互動控制項', () => {
    mockMatchMedia(true)
    render(<PhotoCarousel alt="測試地點" googlePhotoUrls={['https://example.com/g1.jpg']} />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/g1.jpg')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})

describe('PhotoCarousel — 桌面版(2 張以上點擊縮圖開 Lightbox)', () => {
  it('多張圖時,卡片內只顯示第一張縮圖與張數提示,不直接顯示切換控制項', () => {
    mockMatchMedia(true)
    render(
      <PhotoCarousel
        alt="測試地點"
        googlePhotoUrls={['https://example.com/g1.jpg']}
        pexelsPhotoUrls={['https://example.com/p1.jpg']}
      />,
    )

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/g1.jpg')
    expect(screen.getByText('2 張照片')).not.toBeNull()
    // Lightbox 尚未開啟,不該出現關閉鈕。
    expect(screen.queryByRole('button', { name: '關閉' })).toBeNull()
  })

  it('點擊縮圖開啟 Lightbox,可用左右按鈕切換,點關閉鈕收起', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    render(
      <PhotoCarousel
        alt="測試地點"
        googlePhotoUrls={['https://example.com/g1.jpg', 'https://example.com/g2.jpg']}
        pexelsPhotoUrls={['https://example.com/p1.jpg']}
      />,
    )

    await user.click(screen.getByRole('button'))

    const lightbox = screen.getByRole('dialog')
    expect(within(lightbox).getByText('1 / 3')).not.toBeNull()
    await user.click(within(lightbox).getByRole('button', { name: '下一張照片' }))
    expect(within(lightbox).getByText('2 / 3')).not.toBeNull()

    await user.click(within(lightbox).getByRole('button', { name: '關閉' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // 收起後回到卡片內的縮圖(仍是第一張,Lightbox 內部切換不影響卡片
    // 縮圖本身)。
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/g1.jpg')
  })

  it('合併順序永遠是「先 Google 後 Pexels」,不因傳入順序或陣列長度不同而改變', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    render(
      <PhotoCarousel
        alt="測試地點"
        googlePhotoUrls={['https://example.com/g1.jpg', 'https://example.com/g2.jpg']}
        pexelsPhotoUrls={['https://example.com/p1.jpg']}
      />,
    )

    await user.click(screen.getByRole('button'))
    const lightbox = screen.getByRole('dialog')
    expect(within(lightbox).getByText('1 / 3')).not.toBeNull()
    let img = within(lightbox).getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/g1.jpg')

    await user.click(within(lightbox).getByRole('button', { name: '下一張照片' }))
    img = within(lightbox).getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/g2.jpg')

    await user.click(within(lightbox).getByRole('button', { name: '下一張照片' }))
    img = within(lightbox).getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.com/p1.jpg')
  })
})

describe('PhotoCarousel — 手機版(2 張以上橫向並排滑動列,無按鈕)', () => {
  it('多張圖時,直接渲染所有圖片於橫向滑動列中,不顯示左右按鈕或縮圖點擊入口', () => {
    mockMatchMedia(false)
    render(
      <PhotoCarousel
        alt="測試地點"
        googlePhotoUrls={['https://example.com/g1.jpg']}
        pexelsPhotoUrls={['https://example.com/p1.jpg']}
      />,
    )

    const imgs = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgs).toHaveLength(2)
    expect(imgs[0].src).toBe('https://example.com/g1.jpg')
    expect(imgs[1].src).toBe('https://example.com/p1.jpg')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('1 / 2')).not.toBeNull()
  })

  it('圓點頁碼是純顯示用,不是可點擊的按鈕(切換手段是滑動,不是點擊)', () => {
    mockMatchMedia(false)
    render(
      <PhotoCarousel
        alt="測試地點"
        googlePhotoUrls={['https://example.com/g1.jpg', 'https://example.com/g2.jpg']}
      />,
    )

    const dots = screen.getAllByRole('tab')
    expect(dots).toHaveLength(2)
    dots.forEach((dot) => expect(dot.tagName).not.toBe('BUTTON'))
  })
})
