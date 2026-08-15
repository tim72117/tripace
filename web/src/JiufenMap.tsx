import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import './JiufenMap.css';

// JiufenPage 的地點總覽圖——8 個站點的真實座標(用 tripace-cli
// attraction-add -place 查 Google Places 取得,非手動猜測),畫在極簡風格
// 底圖上,取代原本的手繪示意 SVG。技術路線比照 PaceRouteMap.tsx(同一套
// @googlemaps/js-api-loader functional API + MINIMAL_MAP_STYLE 極簡底圖
// 語言),但這裡是純靜態展示(8 個固定 marker,無路線計算、無定位、無
// 互動拖曳),故獨立成一個小很多的元件,不從 PaceRouteMap.tsx 拆共用邏輯
// ——那個元件的複雜度(路線快取、模擬移動、選點儲存)都是這裡用不到的。
export interface JiufenMapStop {
  name: string;
  index: string;
  lat: number;
  lng: number;
  // stopIndex 是選填的呼叫端資料——這個元件本身不使用它,只在 onSelect
  // 回呼時原樣帶回去,方便呼叫端把地圖上的 stop 對應回自己陣列裡的位置
  // (見 JiufenPage.tsx 的用法)。
  stopIndex?: number;
}

// 古紙手繪風——比一般極簡底圖(如 PaceRouteMap.tsx 的 MINIMAL_MAP_STYLE)
// 更進一步偏向復古地圖插畫觀感:整體色調統一偏黃棕(sepia),飽和度壓低、
// 明度拉高模擬泛黃紙張,道路用深褐色細線(對齊等高線地圖的筆觸感),水域
// 用低飽和青綠。這是 Google Maps styler 能做到的上限——真正的手繪筆觸/
// 紙張紋理不是向量底圖圖磚能表現的效果,見使用者要求時的取捨討論。
// 山林(landscape.natural)刻意保留可辨識的綠色調而非蓋成同一片棕色,
// 是因為九份多山、山林是這張地圖重要的地貌資訊,不能被復古色調犧牲掉;
// landscape.man_made(建物聚落區)蓋成泛黃紙色,對齊聚落層疊而建的主題。
const MINIMAL_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#E8DFC8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7A6A4F' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#E8DFC8' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.natural', stylers: [{ color: '#B7C49A' }] },
  { featureType: 'landscape.natural.terrain', stylers: [{ color: '#C7CE9E' }] },
  { featureType: 'landscape.man_made', stylers: [{ color: '#EFE6CE' }] },
  { featureType: 'water', stylers: [{ color: '#A9C4B8' }] },
  { featureType: 'road', stylers: [{ color: '#8B7355' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#6B5B42' }] },
  { featureType: 'road.highway', stylers: [{ color: '#6B5B42' }] },
  { featureType: 'road.local', stylers: [{ color: '#A6906F' }] },
];

// 這個模組層級 flag 跟 PaceRouteMap.tsx/GeoOutlineMap.tsx 各自獨立的那份
// 互不影響——重複呼叫 setOptions 本身無害,但沒必要每個地圖元件各掛一次。
let optionsSet = false;
function ensureOptionsSet(apiKey: string) {
  if (optionsSet) return;
  optionsSet = true;
  setOptions({ key: apiKey, v: 'weekly', language: 'zh-TW' });
}

// onSelect 回傳整個 stop 物件(而非陣列索引)——這個元件的 stops 陣列可能
// 是呼叫端資料的子集(見 JiufenPage.tsx 的 STOP_COORDS 略過起點站不畫在
// 地圖上),陣列位置不等於呼叫端自己資料的索引,由呼叫端自行從 stop 決定
// 要怎麼對應回自己的資料,這個元件不需要知道那層語意。
export function JiufenMap({ stops, onSelect }: { stops: JiufenMapStop[]; onSelect?: (stop: JiufenMapStop) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  useEffect(() => {
    if (!apiKey) {
      setErr('未設定 VITE_GOOGLE_MAPS_API_KEY');
      return;
    }
    if (!containerRef.current || stops.length === 0) return;
    let cancelled = false;

    ensureOptionsSet(apiKey);
    importLibrary('maps')
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return;
        const map = new Map(containerRef.current, {
          center: { lat: stops[0].lat, lng: stops[0].lng },
          zoom: 15,
          styles: MINIMAL_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
        });
        mapRef.current = map;

        const bounds = new google.maps.LatLngBounds();
        stops.forEach((stop) => {
          const position = { lat: stop.lat, lng: stop.lng };
          bounds.extend(position);
          const marker = new google.maps.Marker({
            map,
            position,
            label: {
              text: stop.index,
              fontFamily: "'ShipporiSerif', serif",
              fontSize: '12px',
              fontWeight: '700',
              color: '#F7F3EC',
            },
            // 用 SVG path 畫一個簡單圓形標記,配色對齊頁面的 --vermilion,
            // 不用預設的紅色水滴 icon(跟紙感和風的整體視覺不搭)。
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: '#8B3A2F',
              fillOpacity: 1,
              strokeColor: '#F7F3EC',
              strokeWeight: 2,
            },
            title: stop.name,
          });
          if (onSelect) {
            marker.addListener('click', () => onSelect(stop));
          }
        });
        if (stops.length > 1) map.fitBounds(bounds, 40);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, stops]);

  if (err) {
    return <div className="jiufen-map-error">地圖載入失敗：{err}</div>;
  }
  return <div className="jiufen-map" ref={containerRef} />;
}
