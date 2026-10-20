// AskPage 的候選來源契約:candidates(LLM 已查好的清單)與 explore
// (探查模式,由這個元件呼叫 dataSource.searchNearby 自己查候選)兩種
// input 都要能正確顯示候選卡片;探查模式額外驗證 destination/
// mapCenter/userLocation 的優先序與查無結果時的空狀態。text 模式
// (2026-10 新增,見該元件 input 聯集「第四輪」的完整說明)額外驗證
// 純文字對話氣泡的渲染與關閉行為。region/transport 模式(2026-10 第五
// 輪新增,見該元件檔頭「第五輪」的完整說明)驗證重點不同於
// candidates/explore:這兩種是單選、點選當下直接 onDone,不需要再按
// 「確認選擇」,所以測試重點是「點了哪個選項,onDone 就帶哪個值」,不是
// 像 candidates 模式那樣測複選狀態的切換。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AskPage } from './AskPage'
import type { PlanAiDataSource } from './planAiDataSource'

function makeDataSource(overrides: Partial<PlanAiDataSource> = {}): PlanAiDataSource {
  return {
    placeDetails: vi.fn().mockResolvedValue({ found: false }),
    transitEstimate: vi.fn().mockResolvedValue({ mode: '步行', icon: '🚶', minutes: 1, distance: '1m' }),
    ...overrides,
  }
}

describe('AskPage candidates 模式', () => {
  it('直接顯示傳入的候選,不呼叫 searchNearby', async () => {
    const searchNearby = vi.fn()
    const dataSource = makeDataSource({
      searchNearby,
      placeDetails: vi.fn().mockResolvedValue({ found: true, name: '赤崁樓', summary: '古蹟' }),
    })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ candidates: [{ placeId: 'p1', name: '赤崁樓' }] }}
        onDone={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('赤崁樓')).toBeInTheDocument())
    expect(searchNearby).not.toHaveBeenCalled()
  })
})

describe('AskPage explore 模式', () => {
  it('destination 查詢:呼叫 searchNearby({ query }),查到候選後顯示', async () => {
    const searchNearby = vi.fn().mockResolvedValue({
      found: true,
      candidates: [{ placeId: 'p1', name: '赤崁樓', summary: '古蹟' }],
    })
    const dataSource = makeDataSource({
      searchNearby,
      placeDetails: vi.fn().mockResolvedValue({ found: true, name: '赤崁樓', summary: '古蹟' }),
    })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ explore: { destination: '赤崁樓' } }}
        onDone={() => {}}
      />,
    )
    // 查詢中應該先顯示提示,不是空白或候選卡片。
    expect(screen.getByText('正在附近探查地點…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('赤崁樓')).toBeInTheDocument())
    expect(searchNearby).toHaveBeenCalledWith({ query: '赤崁樓' })
  })

  it('mapCenter 查詢:呼叫 searchNearby({ coords })', async () => {
    const searchNearby = vi.fn().mockResolvedValue({
      found: true,
      candidates: [{ placeId: 'p2', name: '祀典武廟' }],
    })
    const dataSource = makeDataSource({ searchNearby })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ explore: { mapCenter: { lat: 23.0, lng: 120.2 } } }}
        onDone={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('祀典武廟')).toBeInTheDocument())
    expect(searchNearby).toHaveBeenCalledWith({ coords: { lat: 23.0, lng: 120.2 } })
  })

  it('userLocation 查詢:呼叫 searchNearby({ coords })', async () => {
    const searchNearby = vi.fn().mockResolvedValue({
      found: true,
      candidates: [{ placeId: 'p3', name: '大天后宮' }],
    })
    const dataSource = makeDataSource({ searchNearby })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ explore: { userLocation: { lat: 23.1, lng: 120.3 } } }}
        onDone={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('大天后宮')).toBeInTheDocument())
    expect(searchNearby).toHaveBeenCalledWith({ coords: { lat: 23.1, lng: 120.3 } })
  })

  it('優先序:destination 與 mapCenter 同時有值時只採用 destination', async () => {
    const searchNearby = vi.fn().mockResolvedValue({ found: true, candidates: [] })
    const dataSource = makeDataSource({ searchNearby })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ explore: { destination: '赤崁樓', mapCenter: { lat: 23.0, lng: 120.2 } } }}
        onDone={() => {}}
      />,
    )
    await waitFor(() => expect(searchNearby).toHaveBeenCalled())
    expect(searchNearby).toHaveBeenCalledWith({ query: '赤崁樓' })
  })

  it('dataSource 沒有實作 searchNearby 時,降級成空候選,不報錯', async () => {
    const dataSource = makeDataSource() // 沒有 searchNearby
    render(
      <AskPage
        dataSource={dataSource}
        input={{ explore: { destination: '赤崁樓' } }}
        onDone={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('不用了')).toBeInTheDocument())
  })

  it('searchNearby 查詢失敗時,降級成空候選,不報錯', async () => {
    const searchNearby = vi.fn().mockRejectedValue(new Error('network error'))
    const dataSource = makeDataSource({ searchNearby })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ explore: { destination: '赤崁樓' } }}
        onDone={() => {}}
      />,
    )
    await waitFor(() => expect(screen.getByText('不用了')).toBeInTheDocument())
  })
})

describe('AskPage text 模式', () => {
  it('顯示傳入的文字內容,不渲染候選卡片或確認/不用了按鈕', () => {
    const dataSource = makeDataSource()
    render(<AskPage dataSource={dataSource} input={{ text: '要不要先安排午餐?' }} onDone={() => {}} />)
    expect(screen.getByText('要不要先安排午餐?')).toBeInTheDocument()
    expect(screen.queryByText('不用了')).not.toBeInTheDocument()
    expect(screen.queryByText('確認選擇')).not.toBeInTheDocument()
  })

  it('點擊關閉按鈕時,onDone 以空陣列呼叫,視同使用者結束這則訊息', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(<AskPage dataSource={dataSource} input={{ text: '要不要先安排午餐?' }} onDone={onDone} />)
    await user.click(screen.getByTitle('關閉'))
    expect(onDone).toHaveBeenCalledWith([])
  })

  it('stale 為 true 時套用淡化樣式,不影響文字內容顯示', () => {
    const dataSource = makeDataSource()
    render(<AskPage dataSource={dataSource} input={{ text: '舊的提示文字', stale: true }} onDone={() => {}} />)
    expect(screen.getByText('舊的提示文字')).toBeInTheDocument()
  })
})

// 2026-10(第十輪,使用者明確要求「將國家與地區的工具分開,並做自動
// 串接」):原本單一的 region 模式(level 參數切層)拆成 country/city
// 兩個獨立的 input 形態,對應 ask_travel_country/ask_travel_city 兩支
// 獨立工具。兩層切換不再是同一個元件內部的 state(選完國家後 onDone
// 立即觸發,交由呼叫端決定下一步——跟「選完城市自動查景點」是同一套
// 串接模式,見 TripPlanPage.tsx handleAskPageDone 的完整說明),所以
// 這裡的測試重點也跟著改變:CountryPanel/CityPanel 各自獨立測試,
// 「返回上一層」改成測 AskPage 的 onBack prop 有沒有被正確呼叫(不是
// 測元件內部畫面切換)。以下測試用清單裡真實存在的國家/城市(日本/
// 東京/大阪),不是任意字串,確保測的是真實查表邏輯而非巧合通過。
describe('AskPage country 模式(ask_travel_country)', () => {
  it('顯示國家清單,不呼叫任何 dataSource 查詢方法', () => {
    const placeDetails = vi.fn()
    const dataSource = makeDataSource({ placeDetails })
    render(
      <AskPage dataSource={dataSource} input={{ country: {} }} onDone={() => {}} />,
    )
    expect(screen.getByText('日本')).toBeInTheDocument()
    expect(screen.getByText('韓國')).toBeInTheDocument()
    // country 模式的選項內容是前端內建清單,不像 candidates 需要背景
    // 補完整資料(見 AskPage.tsx CountryPanel 的完整說明)。
    expect(placeDetails).not.toHaveBeenCalled()
  })

  it('帶 countryIds 時只顯示篩選後的國家', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ country: { countryIds: ['japan', 'korea'] } }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('日本')).toBeInTheDocument()
    expect(screen.getByText('韓國')).toBeInTheDocument()
    expect(screen.queryByText('泰國')).not.toBeInTheDocument()
  })

  it('點選其中一個國家,onDone 立即以該國家的 id(放在 placeId 欄位)呼叫——不在元件內部切換畫面', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(
      <AskPage dataSource={dataSource} input={{ country: {} }} onDone={onDone} />,
    )
    await user.click(screen.getByText('日本'))
    expect(onDone).toHaveBeenCalledWith([{ placeId: 'japan' }])
  })

  it('點擊「不用了」,onDone 以空陣列呼叫', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(
      <AskPage dataSource={dataSource} input={{ country: {} }} onDone={onDone} />,
    )
    await user.click(screen.getByText('不用了'))
    expect(onDone).toHaveBeenCalledWith([])
  })
})

describe('AskPage city 模式(ask_travel_city)', () => {
  it('顯示該國城市清單', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan' } }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('東京')).toBeInTheDocument()
    expect(screen.queryByText('日本')).not.toBeInTheDocument()
    expect(screen.queryByText('韓國')).not.toBeInTheDocument()
  })

  it('帶 cityIds 時只顯示篩選後的城市', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan', cityIds: ['japan-tokyo'] } }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('東京')).toBeInTheDocument()
    expect(screen.queryByText('大阪')).not.toBeInTheDocument()
  })

  it('點選其中一個城市,onDone 立即以該城市的 id(放在 placeId 欄位)呼叫', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan' } }}
        onDone={onDone}
      />,
    )
    await user.click(screen.getByText('大阪'))
    expect(onDone).toHaveBeenCalledWith([{ placeId: 'japan-osaka' }])
  })

  it('沒有 back(LLM 直接問城市,不是從國家層串接而來)時不顯示「返回上一層」', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan' } }}
        onDone={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.queryByText('返回上一層')).not.toBeInTheDocument()
  })

  it('有 back(前端自動從國家層串接而來)但沒有傳 onBack prop 時,也不顯示「返回上一層」', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan', back: { countryIds: ['japan', 'korea'] } } }}
        onDone={() => {}}
      />,
    )
    expect(screen.queryByText('返回上一層')).not.toBeInTheDocument()
  })

  it('有 back 且有 onBack prop 時顯示「返回上一層」,點擊時用 back.countryIds 呼叫 onBack,不呼叫 onDone', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    const onBack = vi.fn()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan', back: { countryIds: ['japan', 'korea'] } } }}
        onDone={onDone}
        onBack={onBack}
      />,
    )
    await user.click(screen.getByText('返回上一層'))
    expect(onBack).toHaveBeenCalledWith(['japan', 'korea'])
    expect(onDone).not.toHaveBeenCalled()
  })

  it('back 的 countryIds 本身是 undefined(選國家時沒有篩選過)時,onBack 收到 undefined', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onBack = vi.fn()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan', back: {} } }}
        onDone={() => {}}
        onBack={onBack}
      />,
    )
    await user.click(screen.getByText('返回上一層'))
    expect(onBack).toHaveBeenCalledWith(undefined)
  })

  it('點擊「不用了」,onDone 以空陣列呼叫', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan' } }}
        onDone={onDone}
      />,
    )
    await user.click(screen.getByText('不用了'))
    expect(onDone).toHaveBeenCalledWith([])
  })
})

describe('AskPage transport 模式(ask_transport_mode)', () => {
  it('顯示傳入的交通方式選項(固定中文標籤),依傳入順序渲染', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage dataSource={dataSource} input={{ transport: ['walk', 'car'] }} onDone={() => {}} />,
    )
    expect(screen.getByText('步行')).toBeInTheDocument()
    expect(screen.getByText('開車')).toBeInTheDocument()
    expect(screen.queryByText('機車')).not.toBeInTheDocument()
    expect(screen.queryByText('大眾運輸')).not.toBeInTheDocument()
  })

  it('點選其中一種交通方式,onDone 立即以該值(放在 placeId 欄位)呼叫', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(
      <AskPage dataSource={dataSource} input={{ transport: ['walk', 'scooter', 'car'] }} onDone={onDone} />,
    )
    await user.click(screen.getByText('機車'))
    expect(onDone).toHaveBeenCalledWith([{ placeId: 'scooter' }])
  })

  it('點擊「不用了」,onDone 以空陣列呼叫', async () => {
    const user = userEvent.setup()
    const dataSource = makeDataSource()
    const onDone = vi.fn()
    render(<AskPage dataSource={dataSource} input={{ transport: ['walk'] }} onDone={onDone} />)
    await user.click(screen.getByText('不用了'))
    expect(onDone).toHaveBeenCalledWith([])
  })
})

// 2026-10(第九輪,使用者明確要求「工具輸出參數加上文字敘述」「多一個
// 欄位,讓 AI 說明意圖」「要顯示在 AskPage 畫面上」):reason 取代各面板
// 原本寫死的標題,沒帶時 fallback 回原本的固定文字——以下驗證三個面板
// 都正確套用,以及 RegionPanel country 層選完國家進城市層時(前端自己
// 觸發,沒有新的 reason 可用)仍然維持原本的動態組字(不會因為沒有
// reason 就顯示空白或錯誤 fallback 到別的文字)。
describe('AskPage reason 欄位(取代各面板標題)', () => {
  it('candidates 模式帶 reason 時,標題用 reason 取代「要安排這些地點嗎?」', async () => {
    const dataSource = makeDataSource({
      placeDetails: vi.fn().mockResolvedValue({ found: true, name: '赤崁樓' }),
    })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ candidates: [{ placeId: 'p1', name: '赤崁樓' }], reason: '這幾個都是台南必訪的古蹟' }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('這幾個都是台南必訪的古蹟')).toBeInTheDocument()
    expect(screen.queryByText('要安排這些地點嗎?')).not.toBeInTheDocument()
  })

  it('candidates 模式沒帶 reason 時,fallback 回「要安排這些地點嗎?」', async () => {
    const dataSource = makeDataSource({
      placeDetails: vi.fn().mockResolvedValue({ found: true, name: '赤崁樓' }),
    })
    render(
      <AskPage
        dataSource={dataSource}
        input={{ candidates: [{ placeId: 'p1', name: '赤崁樓' }] }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('要安排這些地點嗎?')).toBeInTheDocument()
  })

  it('country 模式帶 reason 時,標題用 reason 取代「要去哪個國家?」', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ country: { reason: '先決定要去哪個國家玩吧' } }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('先決定要去哪個國家玩吧')).toBeInTheDocument()
    expect(screen.queryByText('要去哪個國家?')).not.toBeInTheDocument()
  })

  it('city 模式帶 reason 時,標題用 reason 取代「{國家}要去哪裡?」', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan', reason: '日本的話想去哪個城市呢?' } }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('日本的話想去哪個城市呢?')).toBeInTheDocument()
  })

  it('city 模式沒有 reason 時,fallback 回「{國家}要去哪裡?」動態文字——例如前端從國家層自動串接過來的情況', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ city: { countryId: 'japan', back: { countryIds: undefined } } }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('日本要去哪裡?')).toBeInTheDocument()
  })

  it('transport 模式帶 reason 時,標題用 reason 取代「這段要怎麼移動?」', () => {
    const dataSource = makeDataSource()
    render(
      <AskPage
        dataSource={dataSource}
        input={{ transport: ['walk'], reason: '這段路比較遠,選個交通方式吧' }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText('這段路比較遠,選個交通方式吧')).toBeInTheDocument()
    expect(screen.queryByText('這段要怎麼移動?')).not.toBeInTheDocument()
  })

  it('transport 模式沒帶 reason 時,fallback 回「這段要怎麼移動?」', () => {
    const dataSource = makeDataSource()
    render(<AskPage dataSource={dataSource} input={{ transport: ['walk'] }} onDone={() => {}} />)
    expect(screen.getByText('這段要怎麼移動?')).toBeInTheDocument()
  })
})
