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

// localStorage/sessionStorage 保底:新版 Node(v25 起,實測 v26)內建 Web
// Storage,在 globalThis 掛了一個 getter;沒帶 --localstorage-file 時它回傳
// undefined(只印 ExperimentalWarning)。vitest 的 jsdom 環境裡
// window === globalThis,這個 getter 搶先佔位,jsdom 自己的 localStorage 就
// 拿不到,所有直接碰 localStorage 的測試都會拋
// 「Cannot read properties of undefined」(實測 Node 26 下 45 項失敗,其中
// 41 項是這個原因)。
//
// 只在確實缺失時才補,Node 22(Dockerfile 與 CI 使用的版本)與其他
// jsdom 正常提供 Storage 的環境完全不受影響。
//
// 補的順序:
//   1. 優先用 vitest 的 jsdom 環境暴露的 globalThis.jsdom 實例自己的
//      localStorage——它是真正的 jsdom Storage,測試改寫
//      Storage.prototype.setItem 來模擬配額錯誤(planTimelineStorage.rev
//      .test.ts)才攔得到;用假物件會讓這類測試靜默失效。
//   2. 取不到才退回記憶體版(含 clear/key/length 的 Storage 介面),至少
//      讓不依賴 prototype 行為的測試可以跑。
function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => (data.has(String(key)) ? data.get(String(key))! : null),
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(String(key))
    },
    setItem: (key, value) => {
      data.set(String(key), String(value))
    },
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let available = false
  try {
    available = typeof (globalThis as Record<string, unknown>)[name] !== 'undefined'
  } catch {
    // 存取 getter 本身丟例外也視為不可用。
  }
  if (available) continue

  let replacement: Storage | undefined
  try {
    replacement = (globalThis as { jsdom?: { window?: Record<string, Storage | undefined> } }).jsdom?.window?.[name]
  } catch {
    // jsdom 的 Storage 存取失敗(例如 opaque origin)時退回記憶體版。
  }
  Object.defineProperty(globalThis, name, {
    value: replacement ?? createMemoryStorage(),
    configurable: true,
    writable: true,
  })
}
