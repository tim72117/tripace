import '@testing-library/jest-dom/vitest'

// jsdom 沒有實作 window.matchMedia,任何元件呼叫它(例如
// hooks/useIsDesktop.ts)在測試環境下會直接拋出 TypeError,連帶讓整個
// 測試檔案(不只是觸發到的那個測試案例)中斷。給一個全域的最小可用假
// 實作——預設 matches 為 false(視為手機版寬度),理由是這個專案絕大多數
// 既有測試本來就是針對手機版優先的行為撰寫,這個預設值讓它們不需要
// 額外調整就能繼續通過。個別測試若需要驗證桌面版分支,應在該測試內自行
// 覆寫 window.matchMedia(見 PhotoCarousel.test.tsx 的 mockMatchMedia
// helper),不依賴這裡的預設值。
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
