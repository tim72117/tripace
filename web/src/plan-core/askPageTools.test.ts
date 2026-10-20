// askPageTools.test.ts — 針對 openAskPage/askTravelCountry/
// askTravelCity/askTransportMode 這幾個 ClientTool 補測試:openAskPage
// 測 parseOpenAskPageArgs 的髒資料過濾/優先序組裝,以及 handle 本身
// candidates/explore 二選一的分支與兩者皆空時的 throw 路徑(見
// askPageTools.ts 開頭說明的完整設計理由);askTravelCountry/
// askTravelCity/askTransportMode 測各自的參數驗證與 ctx 呼叫,見下方
// 對應 describe 區塊的完整說明。
//
// 2026-10(第十輪,使用者明確要求「將國家與地區的工具分開,並做自動
// 串接」):原本單一的 askTravelRegion(level 參數切層)拆成
// askTravelCountry/askTravelCity 兩支獨立工具,以下測試跟著拆成兩個
// 獨立的 describe 區塊。
import { describe, expect, it, vi } from 'vitest'
import {
  ALL_TRANSPORT_MODES,
  askTransportMode,
  getUserSelection,
  askTravelCountry,
  askTravelCity,
  openAskPage,
  type AskPageCtx,
  type AskPageSelection,
  type UserSelectionRecord,
  type TransportMode,
} from './askPageTools'

function makeCtx(overrides: Partial<AskPageCtx> = {}): AskPageCtx {
  return {
    openAskPage: vi.fn(async (): Promise<AskPageSelection[]> => []),
    askTravelCountry: vi.fn(async (): Promise<string | null> => null),
    askTravelCity: vi.fn(async (): Promise<string | null> => null),
    askTransportMode: vi.fn(async (): Promise<TransportMode | null> => null),
    getUserSelection: vi.fn(() => null),
    getAttractionPool: vi.fn(() => []),
    getUiState: vi.fn(() => ({ screen: 'timeline' as const, options: [], selected: [], updatedAt: '' })),
    ...overrides,
  }
}

describe('openAskPage.handle — candidates/explore 分支', () => {
  it('candidates 非空時呼叫 ctx.openAskPage({ candidates }),忽略同時傳入的 explore 欄位', async () => {
    const openAskPageCtx = vi.fn(async () => [{ placeId: 'p1' }])
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    const result = await openAskPage.handle(
      { candidates: [{ placeId: 'p1' }], destination: '赤崁樓' },
      ctx,
    )
    expect(openAskPageCtx).toHaveBeenCalledWith({ candidates: [{ placeId: 'p1' }] })
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('candidates 為空、explore 有值時呼叫 ctx.openAskPage({ explore })', async () => {
    const openAskPageCtx = vi.fn(async () => [{ placeId: 'p2' }])
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    const result = await openAskPage.handle({ destination: '安平古堡' }, ctx)
    expect(openAskPageCtx).toHaveBeenCalledWith({ explore: { destination: '安平古堡', mapCenter: undefined, userLocation: undefined } })
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('candidates 與 explore 都空時直接 throw,不呼叫 ctx.openAskPage', async () => {
    const openAskPageCtx = vi.fn()
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await expect(openAskPage.handle({}, ctx)).rejects.toThrow('candidates 不可為空')
    expect(openAskPageCtx).not.toHaveBeenCalled()
  })
})

describe('parseOpenAskPageArgs — candidates 髒資料過濾(透過 handle 間接驗證)', () => {
  it('candidates 中缺少 placeId 的項目被過濾掉,保留格式正確的其餘項目', async () => {
    const openAskPageCtx = vi.fn(async () => [])
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await openAskPage.handle(
      {
        candidates: [
          { placeId: 'ok1' },
          { name: '缺 placeId' },
          { placeId: '' },
          { placeId: 123 },
          null,
          'not-an-object',
          { placeId: 'ok2', name: '第二筆', summary: '摘要' },
        ],
      },
      ctx,
    )
    expect(openAskPageCtx).toHaveBeenCalledWith({
      candidates: [{ placeId: 'ok1', name: undefined, summary: undefined }, { placeId: 'ok2', name: '第二筆', summary: '摘要' }],
    })
  })

  it('name/summary 非 string 時被丟棄為 undefined,不是原樣帶過去', async () => {
    const openAskPageCtx = vi.fn(async () => [])
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await openAskPage.handle(
      { candidates: [{ placeId: 'p1', name: 123, summary: {} }] },
      ctx,
    )
    expect(openAskPageCtx).toHaveBeenCalledWith({
      candidates: [{ placeId: 'p1', name: undefined, summary: undefined }],
    })
  })

  it('candidates 不是陣列時視為空陣列,不丟錯', async () => {
    const openAskPageCtx = vi.fn()
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await expect(openAskPage.handle({ candidates: 'not-an-array' }, ctx)).rejects.toThrow('candidates 不可為空')
  })

  it('raw 本身是 null/非物件時視為空參數,不丟出未預期的錯誤', async () => {
    // handle 的型別簽章是 Record<string, unknown>,但 runtime 實際收到的
    // 是 WS 傳來的 unknown——這裡故意用 any 繞過型別檢查,驗證
    // parseOpenAskPageArgs 對「格式完全不對」的輸入也有防禦。
    const ctx = makeCtx()
    await expect(openAskPage.handle(null as any, ctx)).rejects.toThrow('candidates 不可為空')
    await expect(openAskPage.handle('garbage' as any, ctx)).rejects.toThrow('candidates 不可為空')
  })
})

describe('parseOpenAskPageArgs — explore 的 mapCenter/userLocation 與優先序(透過 handle 間接驗證)', () => {
  it('destination/mapCenter/userLocation 全部沒值時 explore 為 undefined,直接走 throw 分支', async () => {
    const openAskPageCtx = vi.fn()
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await expect(openAskPage.handle({ destination: '' }, ctx)).rejects.toThrow('candidates 不可為空')
    expect(openAskPageCtx).not.toHaveBeenCalled()
  })

  it('mapCenter 缺 lng 時視為無效,parseCoords 回傳 undefined', async () => {
    const openAskPageCtx = vi.fn()
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    // mapCenter 整體無效、且沒有其他探查依據時,explore 應為 undefined,直接落入 throw。
    await expect(openAskPage.handle({ mapCenter: { lat: 23.0 } }, ctx)).rejects.toThrow('candidates 不可為空')
    expect(openAskPageCtx).not.toHaveBeenCalled()
  })

  it('mapCenter.lat/lng 型別不對(非 number)時視為無效', async () => {
    const openAskPageCtx = vi.fn()
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await expect(
      openAskPage.handle({ mapCenter: { lat: '23.0', lng: 120.2 } }, ctx),
    ).rejects.toThrow('candidates 不可為空')
  })

  it('destination 與 mapCenter 同時有值時,explore 只採用 destination(mapCenter 仍會被組進 explore 物件但不影響優先序,優先序由 AskPage.tsx 消費端處理)', async () => {
    const openAskPageCtx = vi.fn(async () => [])
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await openAskPage.handle({ destination: '赤崁樓', mapCenter: { lat: 23.0, lng: 120.2 } }, ctx)
    expect(openAskPageCtx).toHaveBeenCalledWith({
      explore: { destination: '赤崁樓', mapCenter: { lat: 23.0, lng: 120.2 }, userLocation: undefined },
    })
  })

  it('只有 userLocation 有值時,explore 帶著 userLocation,destination/mapCenter 為 undefined', async () => {
    const openAskPageCtx = vi.fn(async () => [])
    const ctx = makeCtx({ openAskPage: openAskPageCtx })
    await openAskPage.handle({ userLocation: { lat: 23.1, lng: 120.3 } }, ctx)
    expect(openAskPageCtx).toHaveBeenCalledWith({
      explore: { destination: undefined, mapCenter: undefined, userLocation: { lat: 23.1, lng: 120.3 } },
    })
  })
})

// 2026-10 改成不等待(使用者明確要求「都不需要等待」,見 askPageTools.ts
// 檔頭第三輪的完整說明):handle 不再 await ctx.openAskPage,所以也不再
// 包裝它的 resolve 結果。改測「不管 ctx.openAskPage 多久才 resolve、
// resolve 成什麼,handle 都立刻回傳 { opened: true }」——那正是「一步
// 接一步、LLM 不用等」這個設計的可驗證形式。
// 回傳訊息開頭要指名是哪個工具成功了(使用者明確要求「ask_travel_region
// 工具要回復 ask_travel_region 已經成功執行」)——同一輪呼叫多個工具時,
// LLM 要分得出是哪一個回來了。
describe('getUserSelection.handle', () => {
  it('有記錄時原樣回傳(含 kind/items/selectedAt)', async () => {
    const record: UserSelectionRecord = {
      kind: 'attractions',
      items: [{ placeId: 'p1', name: '赤崁樓' }],
      selectedAt: '2026-10-19T03:00:00.000Z',
    }
    const ctx = makeCtx({ getUserSelection: vi.fn(() => record) })
    const result = await getUserSelection.handle({}, ctx)
    expect(result).toEqual(record)
  })

  it('沒有記錄時回傳說明用的句子,不是 null——LLM 拿到 null 分不出是系統壞了還是真的沒有', async () => {
    const ctx = makeCtx({ getUserSelection: vi.fn(() => null) })
    const result = await getUserSelection.handle({}, ctx)
    expect(result).toContain('沒有任何使用者選擇的記錄')
  })
})

describe('三個詢問頁工具的回傳訊息都指名自己', () => {
  it('open_ask_page 回傳訊息以工具名開頭、聲明成功執行', async () => {
    const ctx = makeCtx({ openAskPage: vi.fn(async () => []) })
    const result = await openAskPage.handle({ candidates: [{ placeId: 'p1' }] }, ctx)
    expect(result).toContain('open_ask_page 已經成功執行')
  })

  it('ask_travel_country 回傳訊息以工具名開頭、聲明成功執行', async () => {
    const ctx = makeCtx({ askTravelCountry: vi.fn(async () => null) })
    const result = await askTravelCountry.handle({}, ctx)
    expect(result).toContain('ask_travel_country 已經成功執行')
  })

  it('ask_travel_city 回傳訊息以工具名開頭、聲明成功執行', async () => {
    const ctx = makeCtx({ askTravelCity: vi.fn(async () => null) })
    const result = await askTravelCity.handle({ countryId: 'japan' }, ctx)
    expect(result).toContain('ask_travel_city 已經成功執行')
  })

  it('ask_transport_mode 回傳訊息以工具名開頭、聲明成功執行', async () => {
    const ctx = makeCtx({ askTransportMode: vi.fn(async () => null) })
    const result = await askTransportMode.handle({ modes: ['walk'] }, ctx)
    expect(result).toContain('ask_transport_mode 已經成功執行')
  })
})

describe('openAskPage.handle — 不等待 ctx.openAskPage', () => {
  it('ctx.openAskPage 還沒 resolve,handle 就已經回傳 { opened: true }', async () => {
    // 永遠不 resolve 的 Promise:等待模式下 handle 會跟著卡住,這個
    // 案例會 timeout;不等待的話立刻回傳。
    const ctx = makeCtx({ openAskPage: vi.fn(() => new Promise<AskPageSelection[]>(() => {})) })
    const result = await openAskPage.handle({ candidates: [{ placeId: 'p1' }] }, ctx)
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('ctx.openAskPage 之後 resolve 出選擇結果,也不影響已經回傳的值', async () => {
    const selection: AskPageSelection[] = [{ placeId: 'p1', attractionId: 'attr-1' }]
    const ctx = makeCtx({ openAskPage: vi.fn(async () => selection) })
    const result = await openAskPage.handle({ candidates: [{ placeId: 'p1' }] }, ctx)
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })
})

// 2026-10(第六輪,使用者明確要求「詢問區域的 UI 不要做太細,主要是選
// 國家跟區域」):選項內容改成讀取前端內建的固定清單,LLM 只用選填的
// countryIds 篩選/排序要顯示哪些,見 askPageTools.ts AskPageCountryInput
// 的完整說明。
//
// 2026-10(第十輪,使用者明確要求「將國家與地區的工具分開,並做自動
// 串接」):從原本單一的 ask_travel_region(level 參數切層)拆成
// ask_travel_country 獨立工具——沒有 next/level 這些參數,串接邏輯
// 整個搬到 TripPlanPage.tsx 的 handleAskPageDone(這個檔案只測前端
// 無關的 defineTool 層,不是整合測試)。
describe('askTravelCountry.handle', () => {
  it('呼叫 ctx.askTravelCountry({ countryIds: undefined, reason: undefined })(沒有篩選時)', async () => {
    const askTravelCountryCtx = vi.fn(async (): Promise<string | null> => 'japan')
    const ctx = makeCtx({ askTravelCountry: askTravelCountryCtx })
    const result = await askTravelCountry.handle({}, ctx)
    expect(askTravelCountryCtx).toHaveBeenCalledWith({ countryIds: undefined, reason: undefined })
    // 2026-10:改成不等待後,一律回一句完整的指示(見 askPageTools.ts
    // askPageOpenedResult 的完整說明)。這裡只斷言關鍵語意,不比對
    // 整串文字——文案會因為實機觀察 LLM 的反應而微調,鎖死全文會讓
    // 每次調整文案都要改測試,卻擋不住任何真正的行為錯誤。
    expect(result).toContain('正在等待使用者點選')
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('帶 countryIds 時,過濾掉非字串/空字串元素後原樣轉交', async () => {
    const askTravelCountryCtx = vi.fn(async (): Promise<string | null> => null)
    const ctx = makeCtx({ askTravelCountry: askTravelCountryCtx })
    await askTravelCountry.handle({ countryIds: ['japan', '', 123, 'korea'] }, ctx)
    expect(askTravelCountryCtx).toHaveBeenCalledWith({ countryIds: ['japan', 'korea'], reason: undefined })
  })

  it('countryIds 整理後為空陣列時,視為未篩選(undefined)', async () => {
    const askTravelCountryCtx = vi.fn(async (): Promise<string | null> => null)
    const ctx = makeCtx({ askTravelCountry: askTravelCountryCtx })
    await askTravelCountry.handle({ countryIds: ['', 123] }, ctx)
    expect(askTravelCountryCtx).toHaveBeenCalledWith({ countryIds: undefined, reason: undefined })
  })

  it('reason 有值時原樣轉交給 ctx.askTravelCountry', async () => {
    const askTravelCountryCtx = vi.fn(async (): Promise<string | null> => null)
    const ctx = makeCtx({ askTravelCountry: askTravelCountryCtx })
    await askTravelCountry.handle({ reason: '先決定要去哪個國家玩吧' }, ctx)
    expect(askTravelCountryCtx).toHaveBeenCalledWith({ countryIds: undefined, reason: '先決定要去哪個國家玩吧' })
  })

  it('raw 本身是 null/不是物件時視為空參數,不丟錯(沒有必填欄位)', async () => {
    const askTravelCountryCtx = vi.fn(async (): Promise<string | null> => null)
    const ctx = makeCtx({ askTravelCountry: askTravelCountryCtx })
    await askTravelCountry.handle(null as any, ctx)
    expect(askTravelCountryCtx).toHaveBeenCalledWith({ countryIds: undefined, reason: undefined })
  })
})

// 2026-10(第十輪):從原本單一的 ask_travel_region(level: 'city')拆成
// ask_travel_city 獨立工具,countryId 仍是必填——沒有城市清單可以
// 「跨國家」顯示。
describe('askTravelCity.handle', () => {
  it('countryId 合法時呼叫 ctx.askTravelCity({ countryId, cityIds, reason })', async () => {
    const askTravelCityCtx = vi.fn(async (): Promise<string | null> => 'japan-osaka')
    const ctx = makeCtx({ askTravelCity: askTravelCityCtx })
    const result = await askTravelCity.handle({ countryId: 'japan', cityIds: ['japan-osaka'] }, ctx)
    expect(askTravelCityCtx).toHaveBeenCalledWith({
      countryId: 'japan',
      cityIds: ['japan-osaka'],
      reason: undefined,
    })
    // 2026-10:改成不等待後,一律回一句完整的指示(見 askPageTools.ts
    // askPageOpenedResult 的完整說明)。這裡只斷言關鍵語意,不比對
    // 整串文字——文案會因為實機觀察 LLM 的反應而微調,鎖死全文會讓
    // 每次調整文案都要改測試,卻擋不住任何真正的行為錯誤。
    expect(result).toContain('正在等待使用者點選')
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('cityIds 省略時,過濾後是 undefined(顯示該國全部城市)', async () => {
    const askTravelCityCtx = vi.fn(async (): Promise<string | null> => null)
    const ctx = makeCtx({ askTravelCity: askTravelCityCtx })
    await askTravelCity.handle({ countryId: 'japan' }, ctx)
    expect(askTravelCityCtx).toHaveBeenCalledWith({ countryId: 'japan', cityIds: undefined, reason: undefined })
  })

  it('reason 有值時原樣轉交給 ctx.askTravelCity', async () => {
    const askTravelCityCtx = vi.fn(async (): Promise<string | null> => null)
    const ctx = makeCtx({ askTravelCity: askTravelCityCtx })
    await askTravelCity.handle({ countryId: 'japan', reason: '日本的話想去哪個城市呢?' }, ctx)
    expect(askTravelCityCtx).toHaveBeenCalledWith({
      countryId: 'japan',
      cityIds: undefined,
      reason: '日本的話想去哪個城市呢?',
    })
  })

  it('使用者按「不用了」(ctx.askTravelCity resolve null)時,不視為錯誤', async () => {
    const ctx = makeCtx({ askTravelCity: vi.fn(async (): Promise<string | null> => null) })
    const result = await askTravelCity.handle({ countryId: 'japan' }, ctx)
    expect(result).toContain('正在等待使用者點選')
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('countryId 缺漏(或非字串/空字串)時直接 throw,不呼叫 ctx.askTravelCity', async () => {
    const askTravelCityCtx = vi.fn()
    const ctx = makeCtx({ askTravelCity: askTravelCityCtx })
    await expect(askTravelCity.handle({}, ctx)).rejects.toThrow('countryId 為必填')
    await expect(askTravelCity.handle({ countryId: '' }, ctx)).rejects.toThrow('countryId 為必填')
    await expect(askTravelCity.handle({ countryId: 123 }, ctx)).rejects.toThrow('countryId 為必填')
    expect(askTravelCityCtx).not.toHaveBeenCalled()
  })

  it('raw 本身是 null/不是物件時視為空參數,直接 throw', async () => {
    const ctx = makeCtx()
    await expect(askTravelCity.handle(null as any, ctx)).rejects.toThrow('countryId 為必填')
    await expect(askTravelCity.handle('garbage' as any, ctx)).rejects.toThrow('countryId 為必填')
  })
})

// 2026-10(第九輪,使用者明確要求「工具輸出參數加上文字敘述」「多一個
// 欄位,讓 AI 說明意圖」):ctx.askTransportMode 簽名多了選填的第二參數
// reason(見 AskPageCtx.askTransportMode 的完整說明),以下斷言都要連帶
// 補上這個參數(未傳 reason 時是 undefined)。
describe('askTransportMode.handle', () => {
  it('modes 非空時呼叫 ctx.askTransportMode(modes, reason),回傳 { selected }', async () => {
    const askTransportModeCtx = vi.fn(async () => 'scooter' as TransportMode)
    const ctx = makeCtx({ askTransportMode: askTransportModeCtx })
    const result = await askTransportMode.handle({ modes: ['walk', 'scooter'] }, ctx)
    expect(askTransportModeCtx).toHaveBeenCalledWith(['walk', 'scooter'], undefined)
    // 2026-10:改成不等待後,一律回一句完整的指示(見 askPageTools.ts
    // ASK_PAGE_OPENED_RESULT 的完整說明)。這裡只斷言關鍵語意,不比對
    // 整串文字——文案會因為實機觀察 LLM 的反應而微調,鎖死全文會讓
    // 每次調整文案都要改測試,卻擋不住任何真正的行為錯誤。
    expect(result).toContain('正在等待使用者點選')
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('reason 有值時原樣轉交給 ctx.askTransportMode', async () => {
    const askTransportModeCtx = vi.fn(async () => 'scooter' as TransportMode)
    const ctx = makeCtx({ askTransportMode: askTransportModeCtx })
    await askTransportMode.handle({ modes: ['walk'], reason: '這段路比較遠,選個交通方式吧' }, ctx)
    expect(askTransportModeCtx).toHaveBeenCalledWith(['walk'], '這段路比較遠,選個交通方式吧')
  })

  it('使用者按「不用了」(ctx.askTransportMode resolve null)時,selected 為 null,不視為錯誤', async () => {
    const ctx = makeCtx({ askTransportMode: vi.fn(async () => null) })
    const result = await askTransportMode.handle({ modes: ['walk'] }, ctx)
    // 2026-10:改成不等待後,一律回一句完整的指示(見 askPageTools.ts
    // ASK_PAGE_OPENED_RESULT 的完整說明)。這裡只斷言關鍵語意,不比對
    // 整串文字——文案會因為實機觀察 LLM 的反應而微調,鎖死全文會讓
    // 每次調整文案都要改測試,卻擋不住任何真正的行為錯誤。
    expect(result).toContain('正在等待使用者點選')
    expect(result).toContain('不會透過這次工具呼叫回傳')
  })

  it('modes 省略時回退成 ALL_TRANSPORT_MODES(預設全部、預設順序)', async () => {
    const askTransportModeCtx = vi.fn(async () => null)
    const ctx = makeCtx({ askTransportMode: askTransportModeCtx })
    await askTransportMode.handle({}, ctx)
    expect(askTransportModeCtx).toHaveBeenCalledWith(ALL_TRANSPORT_MODES, undefined)
  })

  it('modes 傳入後整理為空陣列(例如全部是不合法值)時同樣回退成 ALL_TRANSPORT_MODES', async () => {
    const askTransportModeCtx = vi.fn(async () => null)
    const ctx = makeCtx({ askTransportMode: askTransportModeCtx })
    await askTransportMode.handle({ modes: ['spaceship', 'teleport'] }, ctx)
    expect(askTransportModeCtx).toHaveBeenCalledWith(ALL_TRANSPORT_MODES, undefined)
  })

  it('modes 裡不合法的值被過濾掉,只保留合法的 TransportMode,且維持呼叫端傳入的順序', async () => {
    const askTransportModeCtx = vi.fn(async () => null)
    const ctx = makeCtx({ askTransportMode: askTransportModeCtx })
    await askTransportMode.handle({ modes: ['car', 'not-a-mode', 'walk'] }, ctx)
    expect(askTransportModeCtx).toHaveBeenCalledWith(['car', 'walk'], undefined)
  })
})
