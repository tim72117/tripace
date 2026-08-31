// geoDistance:兩點間直線距離與徒步分鐘的粗估——供「散策羅盤」的附近景點
// 清單/絲線標籤共用,理由是這批候選景點只有 lat/lng,沒有真實路網資料
// (見 docs/research-curated-attraction-relationships-2026-08.md 的討論),
// 徒步分鐘只能先用直線距離換算,而非真正的路徑時間。

const EARTH_RADIUS_METERS = 6371000
const WALK_METERS_PER_MINUTE = 80 // 日本不動產業界慣例「1 分鐘 = 80 公尺」

// haversineMeters:球面距離(公尺)——比起經緯度差值算矩形範圍(見後端
// ListAttractionsNearby 的說明,那裡的近似對城市尺度查詢範圍已足夠),
// 這裡用在「排序附近景點」與「顯示分鐘數」,需要比矩形近似更準確的
// 點對點距離,故用真正的 Haversine 公式。
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

// walkMinutesEstimate:直線距離換算徒步分鐘,至少 1 分鐘——0 分鐘在畫面上
// 沒有意義(兩個不同景點座標理論上不會完全重合,但保守取下限避免顯示
// 「約 0 分」)。
export function walkMinutesEstimate(meters: number): number {
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE))
}
