import { act, render, screen, waitFor } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 不載入 three/場景資料:mountIsland 與 loadIslandData 換成假的,只驗證頁面的路由、載入狀態與卸載順序。
const events: string[] = []
const mountIsland = vi.fn((_root: HTMLElement, _search: string, data: { sceneId: string }, scene: { sceneId: string; onSwitchScene: (id: string) => void }) => {
  events.push(`mount:${data.sceneId}`)
  void scene
  return () => { events.push(`unmount:${data.sceneId}`) }
})
vi.mock('./mountIsland', () => ({ mountIsland: (...a: Parameters<typeof mountIsland>) => mountIsland(...a) }))

let loadImpl: (id: string) => Promise<unknown>
vi.mock('./islandData', () => ({ loadIslandData: (id: string) => loadImpl(id) }))
vi.mock('../home/SiteNavButtons', () => ({ SiteNavBrand: ({ pageLabel }: { pageLabel: string }) => <div data-testid="brand">{pageLabel}</div> }))

import { IslandPage } from './IslandPage'

const fakeData = (sceneId: string) => ({
  sceneId,
  island: { meta: { title: `標題-${sceneId}`, byline: { name: 'x' } }, stops: [] },
})

function Where() { return <div data-testid="where">{useLocation().pathname}</div> }
function Nav({ to }: { to: string }) { const n = useNavigate(); return <button onClick={() => n(to)}>go</button> }

function renderAt(path: string, extra?: React.ReactNode) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        {extra}
        <Routes>
          <Route path="/island" element={<IslandPage />} />
          <Route path="/island/:sceneId" element={<IslandPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  events.length = 0
  mountIsland.mockClear()
  loadImpl = async (id) => fakeData(id)
})

describe('IslandPage', () => {
  it('/island 載入預設場景:先顯示載入中,載入完成後掛上 mountIsland', async () => {
    let resolve!: (v: unknown) => void
    loadImpl = () => new Promise((r) => { resolve = r })
    renderAt('/island')
    expect(screen.getByRole('status').textContent).toContain('載入')
    expect(mountIsland).not.toHaveBeenCalled()
    await act(async () => { resolve(fakeData('night-jiufen')) })
    await waitFor(() => expect(events).toEqual(['mount:night-jiufen']))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('未知場景 id 導回 /island;預設場景的 id 網址也導回 /island', async () => {
    renderAt('/island/not-exist')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/island'))
    renderAt('/island/night-jiufen')
    await waitFor(() => expect(screen.getAllByTestId('where').every((e) => e.textContent === '/island')).toBe(true))
  })

  it('載入失敗顯示錯誤與重試,重試後成功', async () => {
    let fail = true
    loadImpl = async (id) => { if (fail) throw new Error('offline'); return fakeData(id) }
    renderAt('/island')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('載入失敗')
    fail = false
    await act(async () => { screen.getByRole('button', { name: '重試' }).click() })
    await waitFor(() => expect(events).toEqual(['mount:night-jiufen']))
  })

  it('切換場景:舊場景先卸載、才掛新場景(不會同時存在兩個)', async () => {
    renderAt('/island', <Nav to="/island/sample-islet" />)
    await waitFor(() => expect(events).toEqual(['mount:night-jiufen']))
    await act(async () => { screen.getByRole('button', { name: 'go' }).click() })
    await waitFor(() => expect(events).toEqual(['mount:night-jiufen', 'unmount:night-jiufen', 'mount:sample-islet']))
  })

  it('快速切換:舊場景較晚才載入完成,不會蓋掉新場景', async () => {
    const pending = new Map<string, (v: unknown) => void>()
    loadImpl = (id) => new Promise((r) => { pending.set(id, r) })
    renderAt('/island', <Nav to="/island/sample-islet" />)
    await act(async () => { screen.getByRole('button', { name: 'go' }).click() })
    await act(async () => { pending.get('sample-islet')!(fakeData('sample-islet')) })
    await waitFor(() => expect(events).toEqual(['mount:sample-islet']))
    await act(async () => { pending.get('night-jiufen')!(fakeData('night-jiufen')) }) // 晚到的舊結果
    expect(events).toEqual(['mount:sample-islet'])
  })
})
