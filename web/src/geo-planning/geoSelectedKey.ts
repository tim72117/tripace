// geoSelectedKey——地圖與清單(桌面側欄、手機抽屜、各圖層)共用的「項目識別鍵」。原本寫在 geo-planning/desktop/ResultList.tsx,
// 但手機版與各圖層也依賴它,放在桌面側欄檔案裡不合適(2026-10 抽出)。
//
// selectedKey:目前被選中的項目識別鍵(見下方 geoItemKey),由 desktop/Content
// 中介(理由同 geoPanTarget——側欄與地圖是分開掛載的 sibling)。點擊項目
// 本體時「移動地圖」與「標記選取」是同一個使用者意圖,故沿用 onSelect
// 這個既有 callback 觸發,不另外新增其他 prop。
export type GeoSelectedKey = string | null

// geoItemKey:飯店/景點區域/推薦地點/搜尋結果都沒有穩定的 id(飯店/
// 推薦地點/搜尋結果是即時查詢結果,景點區域可能來自三種不同來源,見
// api.ts 的 GeoAttraction 說明),用「名稱+座標」組合當識別鍵——同一份
// 查詢結果內足以識別惟一項目,不需要额外引入 id 欄位。entry(旅程本身
// 已有座標的 entry,見 GeoTripEntry)雖然有穩定 id,仍沿用同一套
// 「名稱+座標」規則,跟其他來源保持一致,不需要為它另外分岔一套識別
// 邏輯。'attraction' 這個 kind 值仍保留(地圖上的地標圖示/
// AttractionInfoPanel 仍會用到,見 PlanMap.tsx),只是這個側欄不再
// 渲染 attraction 清單。
export function geoItemKey(
  kind: 'hotel' | 'attraction' | 'place' | 'entry' | 'geocode',
  item: { name: string; lat: number; lng: number },
) {
  return `${kind}:${item.name}:${item.lat}:${item.lng}`
}

// geoSelectedKey——從 useAttractionOverlays/useHotelMarkers/
// usePlaceMarkers/useTripEntryMarkers/useGeocodeCandidateMarkers 這 5 個
// marker/overlay 圖層 hook 抽出的共用判斷式。這 5 個 hook 各自重複實作了
// 幾乎一樣的「這個項目是否該顯示選取樣式」(selectedKey === key ||
// hoverKey === key)與「是否該顯示候選籃標記」(candidateKeys?.has(key))
// 邏輯,只是資料型別(hotel/place/entry/attraction/geocode candidate)
// 不同,故抽成純函式集中管理,避免同一行判斷式在 5 個檔案各自維護一份。

// isMarkerSelected:key 命中 selectedKey(側欄/清單點擊選取)或
// hoverKey(滑鼠移過去預覽)其中之一,就該顯示選取樣式。
export function isMarkerSelected(
  key: string,
  selectedKey?: string | null,
  hoverKey?: string | null,
): boolean {
  return selectedKey === key || hoverKey === key
}

// isMarkerCandidate:key 是否在候選籃(candidateKeys)裡——candidateKeys
// 為 undefined 時(該圖層不支援候選籃標記,如 tripEntry)一律回傳 false。
export function isMarkerCandidate(key: string, candidateKeys?: Set<string>): boolean {
  return candidateKeys?.has(key) ?? false
}
