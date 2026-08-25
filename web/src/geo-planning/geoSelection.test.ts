import { describe, it, expect } from 'vitest'
import { geoSelectionReducer, GEO_SELECTION_NONE, type GeoSelection } from './geoSelection'
import type { GeoInfoContent } from './GeoInfoPanel'
import type { GeoAttraction } from '../api'

const hotelContent: GeoInfoContent = {
  name: '測試飯店',
  subtitle: '測試地址',
  badges: [],
}

const attraction: GeoAttraction = {
  name: '測試景點',
  lat: 25.0,
  lng: 121.5,
}

describe('geoSelectionReducer', () => {
  it('初始狀態是 none', () => {
    expect(GEO_SELECTION_NONE).toEqual({ kind: 'none' })
  })

  // 對應「點清單」「點地圖」情境:飯店/地點/POI 這類來源都走
  // SELECT_INFO,一次 dispatch 同時決定 key 與 content,不會出現只設
  // 其中一個的中間態。
  it('SELECT_INFO 同時設定 key 與 content', () => {
    const next = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      key: 'hotel:測試飯店',
      content: hotelContent,
    })
    expect(next).toEqual({ kind: 'info', key: 'hotel:測試飯店', content: hotelContent })
  })

  // 對應「點擊地圖上 Google 原生 POI 圖標」情境(DesktopLayout.tsx 的
  // onPoiSelect)——這是唯一刻意不帶 key 的來源,沒有對應的自建
  // hotel/place/attraction 資料,不需要同步標記側欄清單的選取樣式。
  it('SELECT_INFO 未帶 key 時,key 為 undefined(對應原生 POI 點擊)', () => {
    const next = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      content: hotelContent,
    })
    expect(next.kind).toBe('info')
    expect((next as Extract<GeoSelection, { kind: 'info' }>).key).toBeUndefined()
  })

  // 對應「點地圖上自訂景點圖示」情境——與 SELECT_INFO 互斥,選了
  // attraction 之後不會同時存在 info 卡片的殘留內容。
  it('SELECT_ATTRACTION 設定 attraction,且與 info 互斥', () => {
    const afterInfo = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      key: 'hotel:測試飯店',
      content: hotelContent,
    })
    const next = geoSelectionReducer(afterInfo, {
      type: 'SELECT_ATTRACTION',
      key: 'attraction:測試景點',
      data: attraction,
    })
    expect(next).toEqual({ kind: 'attraction', key: 'attraction:測試景點', data: attraction })
  })

  it('SELECT_INFO 覆蓋既有的 attraction 選取,attraction 資料不殘留', () => {
    const afterAttraction = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_ATTRACTION',
      key: 'attraction:測試景點',
      data: attraction,
    })
    const next = geoSelectionReducer(afterAttraction, {
      type: 'SELECT_INFO',
      key: 'hotel:測試飯店',
      content: hotelContent,
    })
    expect(next).toEqual({ kind: 'info', key: 'hotel:測試飯店', content: hotelContent })
  })

  // 對應「重新搜尋時關閉資訊卡」——這是這個 reducer 要修的原始 bug:
  // 先前分成三個獨立 state,曾經漏清其中一個導致卡片沒有真的關閉。
  // 這裡驗證單一 CLEAR action 確實同時清空 info 與 attraction 兩種狀態。
  it('CLEAR 從 info 狀態回到 none', () => {
    const afterInfo = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      key: 'hotel:測試飯店',
      content: hotelContent,
    })
    expect(geoSelectionReducer(afterInfo, { type: 'CLEAR' })).toEqual({ kind: 'none' })
  })

  it('CLEAR 從 attraction 狀態回到 none', () => {
    const afterAttraction = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_ATTRACTION',
      key: 'attraction:測試景點',
      data: attraction,
    })
    expect(geoSelectionReducer(afterAttraction, { type: 'CLEAR' })).toEqual({ kind: 'none' })
  })

  // 對應「搜尋候選文字/照片平行回補」情境(onGeocodeCandidateText/
  // onGeocodeCandidatePhoto)——PATCH_INFO_CONTENT 只更新部分欄位,
  // 不影響其餘已顯示的內容。
  it('PATCH_INFO_CONTENT 在 info 狀態下局部更新 content', () => {
    const afterInfo = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      key: 'geocode:候選A',
      content: { name: '候選A', badges: [] },
    })
    const next = geoSelectionReducer(afterInfo, {
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => ({ ...prev, photoUrl: 'https://example.com/photo.jpg' }),
    })
    expect(next).toEqual({
      kind: 'info',
      key: 'geocode:候選A',
      content: { name: '候選A', badges: [], photoUrl: 'https://example.com/photo.jpg' },
    })
  })

  // 對應「使用者已經切到別的地點,舊的文字/照片查詢才回來」情境——
  // 這是 GeoOutlinePanel.tsx 的 useEffect + cancelled flag 本來就該擋掉
  // 的競態,但這裡額外驗證即使真的被呼叫到,PATCH_INFO_CONTENT 在非
  // info 狀態下也是安全的 no-op,不會把 attraction 選取誤轉成 info。
  it('PATCH_INFO_CONTENT 在 none/attraction 狀態下是 no-op', () => {
    expect(geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => ({ ...prev, photoUrl: 'x' }),
    })).toEqual(GEO_SELECTION_NONE)

    const afterAttraction = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_ATTRACTION',
      key: 'attraction:測試景點',
      data: attraction,
    })
    expect(geoSelectionReducer(afterAttraction, {
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => ({ ...prev, photoUrl: 'x' }),
    })).toEqual(afterAttraction)
  })

  // 對應「搜尋多筆候選」情境——搜尋清單本身(geocodeCandidates)是
  // GeoOutlinePanel.tsx 另一個獨立 state,不經過這個 reducer;只有
  // 使用者從清單/地圖候選 marker 真的點選其中一筆時,才會走
  // SELECT_INFO,行為與「點清單」「點地圖」共用同一組 action,不需要
  // 額外分支。這裡驗證連續點選兩筆不同候選時,舊的選取內容不會殘留。
  it('連續 SELECT_INFO 兩筆不同候選,只保留最後一筆', () => {
    const first = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      key: 'geocode:候選A',
      content: { name: '候選A', badges: [] },
    })
    const second = geoSelectionReducer(first, {
      type: 'SELECT_INFO',
      key: 'geocode:候選B',
      content: { name: '候選B', badges: [] },
    })
    expect(second).toEqual({ kind: 'info', key: 'geocode:候選B', content: { name: '候選B', badges: [] } })
  })

  // 對應「地圖上連續點同一顆 geocode marker 兩次」的實際 bug:第一次點擊
  // 補查完成後(PATCH_INFO_CONTENT 補上 photoUrl/candidate),第二次點擊
  // 同一個地點若無條件用輕量版 content 覆蓋,已經補齊的欄位會被清空,
  // 且 GeoOutlinePanel.tsx 的補查 effect 依賴 placeId 沒變不會重新觸發,
  // 導致照片/加入行程按鈕永久消失。這裡驗證同一個 key 重複 SELECT_INFO
  // 時保留既有的(較完整的)內容,不整卡覆蓋回呼叫端傳入的輕量版。
  it('SELECT_INFO 對同一個 key 重複選取時,保留既有內容不覆蓋', () => {
    const first = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      key: 'geocode:候選A',
      content: { name: '候選A', badges: [] },
    })
    const patched = geoSelectionReducer(first, {
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => ({ ...prev, photoUrl: 'https://example.com/photo.jpg', candidate: undefined }),
    })
    const secondClickSameKey = geoSelectionReducer(patched, {
      type: 'SELECT_INFO',
      key: 'geocode:候選A',
      content: { name: '候選A', badges: [] },
    })
    expect(secondClickSameKey).toEqual(patched)
  })

  // key 為 undefined 的來源(原生 POI 點擊,見上方「未帶 key」測試)不受
  // 這個保留邏輯影響——每次都視為新一次選取、整卡替換,理由是這類來源
  // 本來就沒有穩定識別鍵可以比對「是不是同一個地點」。
  it('SELECT_INFO 未帶 key 時,即使內容相同也不觸發保留邏輯', () => {
    const first = geoSelectionReducer(GEO_SELECTION_NONE, {
      type: 'SELECT_INFO',
      content: { name: 'POI A', badges: [] },
    })
    const second = geoSelectionReducer(first, {
      type: 'SELECT_INFO',
      content: { name: 'POI B', badges: [] },
    })
    expect(second).toEqual({ kind: 'info', key: undefined, content: { name: 'POI B', badges: [] } })
  })
})
