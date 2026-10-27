// sidebarAd.ts——行程頁左側廣告版位的「全站預設」內容。
//
// 目前沒有接任何廣告商或廣告聯播網,所以是 null:沒有廣告時整個版位不渲染(不留預留框)。
// 每份行程可以用自己的 sidebar.ad 覆蓋(見 types.ts SampleSidebar),這裡只是沒有設定時的預設。
//
// 刻意只支援「一張圖 + 一個連結」的贊助版位,不嵌第三方廣告腳本:嵌聯播網程式碼要有帳號
// 與同意管理(cookie consent)的決策,這份設定不替那件事預設答案。連結一律帶
// rel="sponsored",版位上方固定標示「廣告」。

import type { SampleSidebarAd } from './types'

export const SIDEBAR_AD: SampleSidebarAd | null = null
