import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ItinerarySidebar } from './ItinerarySidebar'
import { makeItinerary } from './testUtils'

const current = makeItinerary([], { id: 'cur', title: '目前行程', region: '北海道', categories: ['溫泉'] })

function renderSidebar(defaultAd?: Parameters<typeof ItinerarySidebar>[0]['defaultAd'], itinerary = current) {
  return render(
    <MemoryRouter>
      <ItinerarySidebar itinerary={itinerary} placement="inline" defaultAd={defaultAd} />
    </MemoryRouter>,
  )
}

describe('ItinerarySidebar', () => {
  it('沒有 sidebar 資料也沒有廣告時整個區塊不出現(沒有全站預設連結)', () => {
    const { container } = renderSidebar(null)
    expect(container.querySelector('aside')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('有 sidebar.sections 時顯示資料指定的連結(站內路徑)', () => {
    const withData = makeItinerary([], {
      id: 'cur', title: '目前行程', region: '北海道', categories: [],
      sidebar: { sections: [{ heading: '延伸閱讀', links: [{ label: '紅葉前線', to: '/momiji-front' }] }] },
    })
    renderSidebar(null, withData)
    expect(screen.getByRole('heading', { name: '延伸閱讀' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /紅葉前線/ })).toHaveAttribute('href', '/momiji-front')
  })
  it('沒有廣告時整個版位都不出現(沒有「廣告」標示、沒有預留框)', () => {
    renderSidebar(null)
    expect(screen.queryByText('廣告')).toBeNull()
    expect(screen.queryByText('廣告版位')).toBeNull()
  })
  it('有廣告時渲染圖片連結:標示「廣告」、rel 含 sponsored、新分頁開啟', () => {
    renderSidebar({ href: 'https://example.com/promo', imageUrl: 'https://example.com/a.png', alt: '贊助商' })
    expect(screen.getByText('廣告')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '贊助商' })
    expect(link).toHaveAttribute('href', 'https://example.com/promo')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('sponsored')
    expect(screen.queryByText('廣告版位')).toBeNull()
  })
  it('整個區塊有「相關資訊」的 landmark 名稱', () => {
    renderSidebar({ href: 'https://example.com/p', imageUrl: 'https://example.com/a.png', alt: '贊助商' })
    expect(screen.getByRole('complementary', { name: '相關資訊' })).toBeInTheDocument()
  })
  it('行程資料的 sidebar.sections 取代預設連結,壞連結不會渲染', () => {
    const withData = makeItinerary([], {
      id: 'cur', title: '目前行程', region: '北海道', categories: [],
      sidebar: { sections: [{ heading: '延伸閱讀', links: [{ label: '資料指定的連結', to: '/momiji-front' }, { label: '惡意連結', to: 'javascript:alert(1)' }] }] },
    })
    renderSidebar(null, withData)
    expect(screen.getByRole('heading', { name: '延伸閱讀' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /資料指定的連結/ })).toHaveAttribute('href', '/momiji-front')
    expect(screen.queryByRole('link', { name: /惡意連結/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /紅葉前線/ })).toBeNull()
  })
  it('行程資料的 sidebar.ad 是 null 時完全不顯示廣告版位', () => {
    const noAd = makeItinerary([], { id: 'cur', title: '目前行程', region: '北海道', categories: [], sidebar: { ad: null } })
    renderSidebar(null, noAd)
    expect(screen.queryByText('廣告')).toBeNull()
    expect(screen.queryByText('廣告版位')).toBeNull()
  })
  it('沒有連結也沒有廣告時整個區塊不渲染(不留空的 landmark)', () => {
    const empty = makeItinerary([], { id: 'cur', title: '目前行程', region: '北海道', categories: [], sidebar: { sections: [] } })
    const { container } = renderSidebar(null, empty)
    expect(screen.queryByRole('complementary', { name: '相關資訊' })).toBeNull()
    expect(container.querySelector('aside')).toBeNull()
  })
  it('資料裡兩個區段同標題也不會有重複 key 的警告', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dup = makeItinerary([], {
      id: 'cur', title: '目前行程', region: '北海道', categories: [],
      sidebar: { sections: [{ heading: '延伸閱讀', links: [{ label: 'A', to: '/a' }] }, { heading: '延伸閱讀', links: [{ label: 'B', to: '/b' }] }] },
    })
    renderSidebar(null, dup)
    expect(screen.getAllByRole('heading', { name: '延伸閱讀' })).toHaveLength(2)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    spy.mockRestore()
  })

  describe('業主投放方案', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('有已發布的方案時,在側欄顯示 compact 卡片並先以行程專屬版位查詢', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          placement: 'itinerary-sidebar',
          campaigns: [{
            campaignID: 'c1',
            plans: [{
              id: 'p1', campaignID: 'c1', category: 'kkday', title: '九份一日遊', status: 'published',
              detail: JSON.stringify({ cid: 'abc', landingUrl: 'https://www.kkday.com/zh-tw/product/1?cid=abc', fromPrice: 'NT$ 599 起' }),
              createdAt: '', updatedAt: '',
            }],
          }],
        }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { container } = renderSidebar(null)
      await waitFor(() => expect(screen.getByText('九份一日遊')).toBeTruthy())
      // 先查這個行程專屬的版位(itinerary-<id>),有方案就不再查預設
      expect(String(fetchMock.mock.calls[0][0])).toContain('placement=itinerary-cur')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.sponsored-plan-card--compact')).not.toBeNull()
      expect(screen.getByText('NT$ 599 起')).toBeTruthy()
    })

    it('行程專屬版位沒有方案時退回 itinerary-sidebar', async () => {
      const empty = { ok: true, json: async () => ({ placement: 'x', campaigns: [] }) }
      const withPlan = {
        ok: true,
        json: async () => ({
          placement: 'itinerary-sidebar',
          campaigns: [{ campaignID: 'c1', plans: [{ id: 'p1', campaignID: 'c1', category: 'kkday', title: '預設方案', status: 'published', detail: '{}', createdAt: '', updatedAt: '' }] }],
        }),
      }
      const fetchMock = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(withPlan)
      vi.stubGlobal('fetch', fetchMock)
      renderSidebar(null)
      await waitFor(() => expect(screen.getByText('預設方案')).toBeTruthy())
      expect(String(fetchMock.mock.calls[0][0])).toContain('placement=itinerary-cur')
      expect(String(fetchMock.mock.calls[1][0])).toContain('placement=itinerary-sidebar')
    })

    it('沒有方案時不渲染任何贊助卡片', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ placement: 'itinerary-sidebar', campaigns: [] }) }))
      const { container } = renderSidebar(null)
      await new Promise((r) => setTimeout(r, 20))
      expect(container.querySelector('.sponsored-plan-card')).toBeNull()
    })
  })
})
