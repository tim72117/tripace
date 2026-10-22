// TripManageDialog:點背景關閉、點卡片不關閉;擁有者判斷用 trip.ownerID === userID。
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

const modalProps = vi.fn()
vi.mock('./TripManageModal', () => ({
  TripManageModal: (p: { isOwner: boolean }) => {
    modalProps(p)
    return <div data-testid="modal" />
  },
}))

import { TripManageDialog } from './TripManageDialog'

const trip = { id: 't1', name: 'T', ownerID: 'u1' } as never

describe('TripManageDialog', () => {
  it('擁有者判斷:trip.ownerID === userID', () => {
    modalProps.mockClear()
    render(<TripManageDialog cfg={{ baseURL: 'http://x', token: null }} trip={trip} userID="u1" onClose={() => {}} />)
    expect(modalProps.mock.calls[0][0].isOwner).toBe(true)
    modalProps.mockClear()
    render(<TripManageDialog cfg={{ baseURL: 'http://x', token: null }} trip={trip} userID="u2" onClose={() => {}} />)
    expect(modalProps.mock.calls[0][0].isOwner).toBe(false)
  })

  it('點背景關閉、點卡片本身不關閉', () => {
    const onClose = vi.fn()
    const { container, getByTestId } = render(
      <TripManageDialog cfg={{ baseURL: 'http://x', token: null }} trip={trip} userID="u1" onClose={onClose} />,
    )
    fireEvent.click(getByTestId('modal'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.rp-modal-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
