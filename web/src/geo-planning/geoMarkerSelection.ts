// geoMarkerSelection——從 useAttractionOverlays/useHotelMarkers/
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
