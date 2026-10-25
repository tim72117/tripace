// 分享連結的 QR Code 區塊:QR 圖(非同步產生)還沒好時,外框與圖片位置
// 要先站位(同 class 的空區塊),避免 QR 出現時整個彈窗往下跳。
//
// qrcode 的 toDataURL 換成可控的 deferred:每次呼叫排進 pending,測試決定何時 resolve/reject,
// 才能斷言「產生中 → 產生完成/失敗」的切換,以及 token 換新時舊 QR 的去留。
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import styles from './TripManageModal.module.css'

interface PendingQr {
  url: string
  resolve: (dataUrl: string) => void
  reject: (e: unknown) => void
}
const qr = vi.hoisted(() => ({ pending: [] as PendingQr[] }))

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (url: string) =>
      new Promise<string>((resolve, reject) => {
        qr.pending.push({ url, resolve, reject })
      }),
  },
}))
vi.mock('../api', async (orig) => {
  const actual = await orig<typeof import('../api')>()
  return {
    ...actual,
    getPublicLink: vi.fn(),
    createPublicLink: vi.fn(),
    fetchMembers: vi.fn().mockResolvedValue([]),
  }
})

import * as api from '../api'
import { TripManageModal } from './TripManageModal'

const publicUrlOf = (token: string) => `${window.location.origin}/public/${token}`

function renderModal() {
  return render(
    <TripManageModal
      cfg={{ baseURL: '', token: 't' } as never}
      trip={{ id: 't1', name: 'T', ownerID: 'u1' } as never}
      isOwner
      onClose={() => {}}
    />,
  )
}

// qrBox——QR 區塊的外框:class 恰好是 styles.qrBox,且整個畫面只有一個。
function qrBox(container: HTMLElement): HTMLElement {
  const boxes = Array.from(container.querySelectorAll<HTMLElement>(`.${styles.qrBox}`))
  expect(boxes).toHaveLength(1)
  expect(boxes[0].className).toBe(styles.qrBox)
  return boxes[0]
}

// editableToggle——分享區的「允許訪客新增行程」開關(彈窗裡還有別的 checkbox,不能抓第一個)。
function editableToggle(): HTMLInputElement {
  const input = screen.getByText('允許訪客新增行程').parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('找不到「允許訪客新增行程」開關')
  return input
}

// 等到第 n 次 toDataURL 呼叫出現,回傳那一次的 deferred。
async function nthQrCall(n: number): Promise<PendingQr> {
  await waitFor(() => expect(qr.pending.length).toBeGreaterThanOrEqual(n))
  return qr.pending[n - 1]
}

beforeEach(() => {
  qr.pending.length = 0
  vi.mocked(api.getPublicLink).mockResolvedValue({ linkToken: 'tok', editable: false, viewMode: 'timeline' } as never)
})

afterEach(() => {
  vi.mocked(api.getPublicLink).mockReset()
  vi.mocked(api.createPublicLink).mockReset()
})

describe('TripManageModal QR 站位', () => {
  it('QR 尚未產生時:qrBox 內只有一個佔位區塊,class 恰好等於 styles.qrImage', async () => {
    const { container } = renderModal()
    const ph = await screen.findByTestId('qr-placeholder')
    expect(ph.className).toBe(styles.qrImage)
    expect(ph.parentElement).toBe(qrBox(container))
    expect(qrBox(container).children).toHaveLength(1)
    expect(qrBox(container).querySelector('img')).toBeNull()
    // QR 以公開連結產生
    expect((await nthQrCall(1)).url).toBe(publicUrlOf('tok'))
  })

  it('QR 產生完成:同一個 qrBox 內換成 img,className 與佔位相同,佔位消失', async () => {
    const { container } = renderModal()
    const ph = await screen.findByTestId('qr-placeholder')
    const box = qrBox(container)
    const placeholderClass = ph.className

    const call = await nthQrCall(1)
    await act(async () => call.resolve('data:image/png;base64,QR-TOK'))

    const img = screen.getByAltText('分享連結 QR Code') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QR-TOK')
    expect(img.className).toBe(placeholderClass)
    expect(img.parentElement).toBe(box)
    expect(qrBox(container)).toBe(box)
    expect(box.children).toHaveLength(1)
    expect(screen.queryByTestId('qr-placeholder')).toBeNull()
  })

  it('QR 產生失敗:維持佔位區塊(外框不塌),不出現 img', async () => {
    const { container } = renderModal()
    await screen.findByTestId('qr-placeholder')
    const call = await nthQrCall(1)
    await act(async () => call.reject(new Error('boom')))

    const ph = screen.getByTestId('qr-placeholder')
    expect(ph.className).toBe(styles.qrImage)
    expect(ph.parentElement).toBe(qrBox(container))
    expect(container.querySelector('img')).toBeNull()
  })

  it('token 換新(切換「允許訪客新增行程」):已知行為——新 QR 產生前舊 token 的 QR 繼續顯示(不閃回佔位),新的好了才換;新的失敗則退回佔位', async () => {
    vi.mocked(api.createPublicLink).mockResolvedValueOnce({ linkToken: 'tok2', editable: true, viewMode: 'timeline' } as never)
    const { container } = renderModal()
    await screen.findByTestId('qr-placeholder')
    await act(async () => (await nthQrCall(1)).resolve('data:image/png;base64,QR-TOK'))
    const box = qrBox(container)

    fireEvent.click(editableToggle())
    const second = await nthQrCall(2)
    expect(second.url).toBe(publicUrlOf('tok2'))
    // 已知行為(刻意鎖住):新 QR 還在產生時,畫面上仍是舊 token 的 QR。
    // 若日後改成「換新期間顯示佔位」,這裡要跟著改成斷言佔位。
    expect(screen.getByAltText('分享連結 QR Code').getAttribute('src')).toBe('data:image/png;base64,QR-TOK')
    expect(screen.queryByTestId('qr-placeholder')).toBeNull()

    await act(async () => second.resolve('data:image/png;base64,QR-TOK2'))
    const img = screen.getByAltText('分享連結 QR Code')
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QR-TOK2')
    expect(img.className).toBe(styles.qrImage)
    expect(qrBox(container)).toBe(box)

    // 再換一次 token,這次產生失敗:不留著上一個 token 的 QR(那會指向舊連結),退回佔位
    vi.mocked(api.createPublicLink).mockResolvedValueOnce({ linkToken: 'tok3', editable: false, viewMode: 'timeline' } as never)
    fireEvent.click(editableToggle())
    const third = await nthQrCall(3)
    expect(third.url).toBe(publicUrlOf('tok3'))
    await act(async () => third.reject(new Error('boom')))
    expect(screen.queryByAltText('分享連結 QR Code')).toBeNull()
    expect(screen.getByTestId('qr-placeholder').parentElement).toBe(qrBox(container))
  })

  it('舊 token 的 QR 比新的晚完成:晚到的舊結果被丟棄,不會蓋掉新 token 的 QR', async () => {
    vi.mocked(api.createPublicLink).mockResolvedValueOnce({ linkToken: 'tok2', editable: true, viewMode: 'timeline' } as never)
    renderModal()
    await screen.findByTestId('qr-placeholder')
    const first = await nthQrCall(1)

    fireEvent.click(editableToggle())
    const second = await nthQrCall(2)
    await act(async () => second.resolve('data:image/png;base64,QR-TOK2'))
    await act(async () => first.resolve('data:image/png;base64,QR-TOK-STALE'))

    expect(screen.getByAltText('分享連結 QR Code').getAttribute('src')).toBe('data:image/png;base64,QR-TOK2')
  })
})
