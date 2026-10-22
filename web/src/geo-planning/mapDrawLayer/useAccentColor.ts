import { useEffect, useState } from 'react'

// useAccentColor——讀地圖容器上的主題強調色(CSS 變數 --color-accent)。
//
// 功能層是純資料(沒有副作用,拿不到地圖),但路線、圓圈等需要強調色。顏色會隨明暗主題不同,
// 所以由接線的那一層呼叫這個 hook 取得,再當成輸入傳給功能層。theme 或 mapVersion 改變時重新讀。
// 讀不到時退回預設色(與既有圖層一致)。
export const DEFAULT_ACCENT_COLOR = '#8B3A2F'

export function useAccentColor({
  mapRef,
  mapReady,
  theme,
  mapVersion = 0,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  theme?: string | null
  mapVersion?: number
}): string {
  const [color, setColor] = useState(DEFAULT_ACCENT_COLOR)

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    const value = getComputedStyle(map.getDiv()).getPropertyValue('--color-accent').trim()
    setColor(value || DEFAULT_ACCENT_COLOR)
  }, [mapRef, mapReady, theme, mapVersion])

  return color
}
