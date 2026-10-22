// PlanPhoneView 的 controlsPortalTarget:控制項(搜尋框等)的傳送目標由呼叫端提供
// (phone/Content 的 PlanOverlayLayout 插槽),PlanPhoneView 原封不動轉給 PlanMap,
// 自己不再渲染 .uiLayer。mock 掉 PlanMap,只驗證它收到什麼。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanPhoneView } from './PlanPhoneView'
import type { ClientConfig } from '../api'
import type { User } from '../user/types'

let captured: { controlsPortalTarget?: HTMLElement | null } = {}

vi.mock('./PlanMap', () => ({
  EXPLORE_CATEGORY: 'explore',
  PlanMap: (props: { controlsPortalTarget?: HTMLElement | null; children?: React.ReactNode }) => {
    captured = { controlsPortalTarget: props.controlsPortalTarget }
    return props.children ?? null
  },
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const user: User = { id: 'usr_1', name: '測試使用者', avatarColor: '#000' }

function renderView(target?: HTMLElement | null) {
  return render(
    <PlanPhoneView
      cfg={cfg}
      tripID="trip_1"
      activeTrip={null}
      user={user}
      onOpenSettings={() => {}}
      onOpenTrips={() => {}}
      controlsPortalTarget={target}
    />,
  )
}

describe('PlanPhoneView controlsPortalTarget', () => {
  it('把呼叫端給的目標原封不動轉給 PlanMap', () => {
    const el = document.createElement('div')
    renderView(el)
    expect(captured.controlsPortalTarget).toBe(el)
  })

  it('目標為 null(插槽尚未掛載):照樣轉成 null,讓 PlanMap 先不渲染控制項', () => {
    renderView(null)
    expect(captured.controlsPortalTarget).toBeNull()
  })

  it('沒有傳:PlanMap 收到 undefined(原地渲染),自己不再有 .uiLayer', () => {
    const { container } = renderView()
    expect(captured.controlsPortalTarget).toBeUndefined()
    expect(container.querySelector('[class*="uiLayer"]')).toBeNull()
  })
})
