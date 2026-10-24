import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { PlanDataProvider } from './PlanDataProvider'
import type { PlanAiDataSource } from './dataSource'

// 測試輔助:消費 PlanDataProvider 的元件/hook 要在 Provider 底下才能用(沒有 Provider 會丟明確的錯誤)。
// 沒有指定 dataSource 時用「什麼都查不到」的最小實作(placeDetails found:false),適合與解析結果無關的測試。

export function makeNullDataSource(): PlanAiDataSource {
  return {
    placeDetails: async () => ({ found: false }),
    transitEstimate: async () => ({ mode: 'walking', icon: '', minutes: 0, distance: '' }),
  } as unknown as PlanAiDataSource
}

// withPlanData——給 renderHook 的 { wrapper } 或 render 的 wrapper 用。
export function withPlanData(dataSource: PlanAiDataSource = makeNullDataSource()) {
  return function PlanDataWrapper({ children }: { children: ReactNode }) {
    return <PlanDataProvider dataSource={dataSource}>{children}</PlanDataProvider>
  }
}

export function renderWithPlanData(ui: ReactElement, dataSource?: PlanAiDataSource, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: withPlanData(dataSource), ...options })
}

// dataSourceFromRefs——把「id → 解析結果」的表做成資料存取層:placeDetails(id) 回表裡那一筆(沒有就 found:false)。
// 給原本直接傳 resolvedRefs 表的測試用:現在視圖向 store 取資料,測試改成提供一個回答這些 id 的資料來源,
// 解析結果在查詢回來後才出現(用 findBy / waitFor 等)。
export function dataSourceFromRefs(refs: ReadonlyMap<string, import('./planTimeline').PlanThemeChild>): PlanAiDataSource {
  return {
    placeDetails: async (id: string) => {
      const c = refs.get(id)
      if (!c) return { found: false }
      return { found: true, name: c.name, summary: c.desc, lat: c.lat, lng: c.lng, googlePhotoUrls: c.googlePhotoUrls }
    },
    transitEstimate: async () => ({ mode: 'walking', icon: '', minutes: 0, distance: '' }),
  } as unknown as PlanAiDataSource
}
