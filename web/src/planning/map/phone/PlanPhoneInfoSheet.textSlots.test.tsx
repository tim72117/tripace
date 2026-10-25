// PlanPhoneInfoSheet 的徽章列/簡介/照片站位——Google 地點來源開卡時評分
// 與簡介還沒到(見 place/infoContent.ts 的 reservesLateTextSlots),標頭的
// 徽章列要先佔位,否則評分補上時標頭變高、照片與簡介整塊往下推;照片
// 外框無論有沒有照片都在。jsdom 不做版面計算,只斷言 DOM 與 class。
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { PlanPhoneInfoSheet } from './PlanPhoneInfoSheet'
import styles from './PlanPhoneInfoSheet.module.css'
import carouselStyles from '../../place/PhotoCarousel.module.css'
import type { PlaceInfoContent } from '../../place/PlacePanel'
import type { PlanAiDataSource } from '../../data/source'
import type { GeoAttraction } from '../../../api'

class FakeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}
vi.stubGlobal('IntersectionObserver', FakeObserver)
vi.stubGlobal('ResizeObserver', FakeObserver)
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia

const dataSource = {} as PlanAiDataSource
// pending:評分、簡介都還沒有(不帶 textStatus),照片還在查(photoStatus pending)。
const pending: PlaceInfoContent = { name: '九份老街', placeId: 'p1', subtitle: '新北市瑞芳區基山街', badges: [], photoStatus: 'pending' }
const arrived: PlaceInfoContent = {
  ...pending,
  photoStatus: undefined,
  summary: '依山而建的老街。',
  badges: ['評分 4.3'],
  googlePhotoUrls: ['https://example.com/a.jpg'],
}

function renderSheet(content: PlaceInfoContent) {
  return render(<PlanPhoneInfoSheet content={content} attraction={null} dataSource={dataSource} onClose={() => {}} />)
}

describe('PlanPhoneInfoSheet 文字/照片晚到時的站位', () => {
  it('評分、簡介、照片都還沒到:標頭有空的 .metaRow、簡介帶 .summaryReserved、照片外框與佔位都在', () => {
    renderSheet(pending)
    const meta = document.querySelector(`.${styles.metaRow}`)
    expect(meta).not.toBeNull()
    expect(meta!.children.length).toBe(0)
    expect(document.querySelector(`.${styles.summaryEmpty}`)!.className).toContain(styles.summaryReserved)
    const imageWrap = document.querySelector(`.${styles.imageWrap}`)!
    expect(imageWrap.querySelector(`.${carouselStyles.wrap}`)).not.toBeNull()
    // 照片外框改用 FramedImage:照片還在查(photoStatus pending)時是掃光佔位。
    expect(imageWrap.querySelector(`.${carouselStyles.wrap} > [data-status="loading"] [data-skeleton="block"]`)).not.toBeNull()
  })

  it('資料補上後:.metaRow、簡介站位 class 與照片外框 class 都不變', () => {
    const { rerender } = renderSheet(pending)
    const wrapBefore = document.querySelector(`.${carouselStyles.wrap}`)!
    rerender(<PlanPhoneInfoSheet content={arrived} attraction={null} dataSource={dataSource} onClose={() => {}} />)
    expect(document.querySelector(`.${styles.metaRow}`)!.children.length).toBe(1)
    expect(document.querySelector(`.${styles.summary}`)!.className).toContain(styles.summaryReserved)
    const wrapAfter = document.querySelector(`.${carouselStyles.wrap}`)!
    expect(wrapAfter.className).toBe(wrapBefore.className)
    expect(wrapAfter.querySelector('[data-status="loading"] > img')).not.toBeNull()
  })
})

// textStatus 骨架:理由同 place/PlacePanel.textSlots.test.tsx 的同名區塊。
describe('PlanPhoneInfoSheet 文字查詢中的骨架', () => {
  const loading: PlaceInfoContent = { ...pending, textStatus: 'pending' }

  it('textStatus=pending:簡介骨架帶 aria、3 條,徽章列有骨架徽章,不顯示原句', () => {
    renderSheet(loading)
    const status = document.querySelector('[role="status"][aria-label="簡介載入中"]')!
    expect(status).not.toBeNull()
    expect(status.querySelectorAll('[data-skeleton-line]').length).toBe(3)
    expect(status.className).toContain(styles.summaryReserved)
    expect(document.querySelector(`.${styles.metaRow}`)!.querySelectorAll('[data-skeleton="block"]').length).toBe(1)
    expect(document.body.textContent).not.toContain('這個地點還沒有簡介資料。')
  })

  it('文字到了:骨架消失,簡介外框仍帶 .summaryReserved', () => {
    const { rerender } = renderSheet(loading)
    rerender(<PlanPhoneInfoSheet content={arrived} attraction={null} dataSource={dataSource} onClose={() => {}} />)
    expect(document.querySelector('[role="status"][aria-label="簡介載入中"]')).toBeNull()
    expect(document.querySelector(`.${styles.metaRow} [data-skeleton="block"]`)).toBeNull()
    expect(document.querySelector(`.${styles.summary}`)!.className).toContain(styles.summaryReserved)
  })

  it('查詢完成但沒有簡介仍顯示原句;失敗顯示「簡介載入失敗。」', () => {
    const { rerender } = renderSheet(pending)
    expect(document.body.textContent).toContain('這個地點還沒有簡介資料。')
    rerender(<PlanPhoneInfoSheet content={{ ...pending, textStatus: 'failed' }} attraction={null} dataSource={dataSource} onClose={() => {}} />)
    expect(document.body.textContent).toContain('簡介載入失敗。')
    expect(document.querySelector('[role="status"][aria-label="簡介載入中"]')).toBeNull()
  })
})

// 主題點(attraction)照片:由這張卡片自己的 placeDetails effect 查詢——查詢中掃光,
// 查詢失敗改成靜態佔位,不再因為「沒有照片」一律掃光而永遠像在載入。
describe('PlanPhoneInfoSheet 主題點照片查詢狀態', () => {
  const attraction = { id: 'a1', name: '九份', placeId: 'pa', lat: 25.1, lng: 121.8 } as GeoAttraction

  it('查詢中:掃光;查詢失敗:同一個外框改成靜態佔位', async () => {
    let reject: (e: Error) => void = () => {}
    const ds = {
      geoPlaceDetails: () => new Promise<never>((_, r) => { reject = r }),
    } as unknown as PlanAiDataSource
    render(<PlanPhoneInfoSheet content={null} attraction={attraction} dataSource={ds} onClose={() => {}} />)
    const frame = document.querySelector(`.${carouselStyles.wrap} > [data-status]`) as HTMLElement
    expect(frame.dataset.status).toBe('loading')
    await act(async () => reject(new Error('boom')))
    expect(document.querySelector(`.${carouselStyles.wrap} > [data-status]`)).toBe(frame)
    expect(frame.dataset.status).toBe('idle')
    expect(frame.querySelector('[data-skeleton="block"]')).toBeNull()
  })
})
