// zOrder 測試:marker 類群組的相對順序(數字越大越上面)。
import { describe, it, expect } from 'vitest'
import { GROUP_Z } from './zOrder'

describe('GROUP_Z', () => {
  it('行程站點:hover 在最上、選中次之、一般站點再下、主題子景點小點最底(對照舊圖層的 999、998、不設)', () => {
    expect(GROUP_Z.planStopHover).toBeGreaterThan(GROUP_Z.planStopSelected)
    expect(GROUP_Z.planStopSelected).toBeGreaterThan(GROUP_Z.planStop)
    expect(GROUP_Z.planStop).toBeGreaterThan(GROUP_Z.planStopChild)
  })

  it('強調態的站點要蓋過搜尋結果、行程 entry 與藍點', () => {
    for (const g of ['searchResult', 'tripEntry', 'currentLocation'] as const) {
      expect(GROUP_Z.planStopSelected).toBeGreaterThan(GROUP_Z[g])
    }
  })

  it('搜尋結果:選中最上、定位結果次之、一般最底;行程 entry 選中同樣置頂(對照舊 hook 的 999、998、不設)', () => {
    expect(GROUP_Z.searchResultSelected).toBeGreaterThan(GROUP_Z.searchResultGeocode)
    expect(GROUP_Z.searchResultGeocode).toBeGreaterThan(GROUP_Z.searchResult)
    expect(GROUP_Z.tripEntrySelected).toBeGreaterThan(GROUP_Z.tripEntry)
    expect(GROUP_Z.tripEntrySelected).toBeGreaterThanOrEqual(GROUP_Z.searchResultGeocode)
  })

  it('目前位置藍點在所有 marker 的最底層', () => {
    for (const [name, z] of Object.entries(GROUP_Z)) {
      if (name !== 'currentLocation') expect(z).toBeGreaterThan(GROUP_Z.currentLocation)
    }
  })
})
