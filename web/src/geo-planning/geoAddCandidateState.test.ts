import { describe, it, expect } from 'vitest'
import { initialAddCandidateUiState, reduceAddCandidateUiState, type AddCandidateUiState } from './geoAddCandidateState'

function run(events: Parameters<typeof reduceAddCandidateUiState>[1][]): AddCandidateUiState[] {
  const snapshots: AddCandidateUiState[] = []
  let state = initialAddCandidateUiState
  for (const event of events) {
    state = reduceAddCandidateUiState(state, event)
    snapshots.push(state)
  }
  return snapshots
}

describe('reduceAddCandidateUiState', () => {
  it('初始狀態:closed', () => {
    expect(initialAddCandidateUiState).toEqual({ mode: 'closed' })
  })

  it('added:進入已加入的短暫提示狀態', () => {
    const [afterAdded] = run([{ type: 'added' }])
    expect(afterAdded).toEqual({ mode: 'added' })
  })

  it('完整流程:added → reset', () => {
    const [afterAdded, afterReset] = run([
      { type: 'added' },
      { type: 'reset' },
    ])
    expect(afterAdded).toEqual({ mode: 'added' })
    expect(afterReset).toEqual({ mode: 'closed' })
  })

  it('reset 在任何狀態下都能收斂回 closed', () => {
    const [, afterReset] = run([{ type: 'added' }, { type: 'reset' }])
    expect(afterReset).toEqual({ mode: 'closed' })
  })

  it('closed 狀態下 reset 維持 closed(冪等)', () => {
    const [afterReset] = run([{ type: 'reset' }])
    expect(afterReset).toEqual({ mode: 'closed' })
  })
})
