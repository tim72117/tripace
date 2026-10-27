// sidebarDefaults.ts——行程頁左側連結區塊的「預設內容」(行程資料沒有設定 sidebar.sections 時用)。
//
// 目前只放紅葉前線。要加連結改這裡(全站預設),或在單一行程的 sidebar.sections 指定
// (見 types.ts SampleSidebar),後者會完全取代這份預設。

import type { SidebarSection } from './sidebarData'

export const DEFAULT_SIDEBAR_SECTIONS: ReadonlyArray<SidebarSection> = [
  {
    heading: '延伸閱讀',
    links: [{ id: 'momiji-front', label: '紅葉前線', hint: '各地楓葉變色時程', to: '/momiji-front' }],
  },
]
