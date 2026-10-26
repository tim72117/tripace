// 島的版面資料型別——「契約」:視覺設計(src/island/layout.ts)依這個型別填資料,
// 渲染層(src/three/*)依這個型別讀資料。要改欄位先同步兩邊。
//
// 座標約定:平面座標 (x, z),單位 = 公尺感的「格」,島中心在 (0, 0),
// +x 向右(東)、+z 向前(南,朝鏡頭)、+y 向上。模型的 1 單位 = 物件本身的 size,
// 放進島時用 scale 放大(例如樹 scale 4 約 4 格高)。島的半徑約 30~40 格。

export type Pt = [number, number] // [x, z]

export type Placement = {
  model: string // src/models/<model>.ts 的檔名(不含副檔名)
  x: number
  z: number
  rotY?: number // 弧度,繞 Y 軸
  scale?: number // 預設 1
  seed?: number // 同款模型的小變化(顏色/縮放抖動)用的亂數種子
  y?: number // 腳底高度(放在階梯平台上時用,預設 0 = 最低的地面)
}

// StopAnchor:部落客文章的一站在島上的位置與外觀。stopId 對應文章 stop 區塊的 id
// (docs/source-night-jiufen.json 的 blocks[].id,例如 'stop_1');島的內容就是
// 「由一篇部落客文章自動生成」,所以站點資料以文章為準,這裡只加視覺相關欄位。
export type StopAnchor = Placement & {
  stopId: string // 例如 'stop_1'
  label: string // 島上顯示的短標籤(一站一行),通常等於文章的站名
  time: string // 'HH:MM',文章沒有時間,這是示意時間,決定日夜演出與旅人何時到站
  emoji?: string // 標籤前的小圖示(選填)
  blurb?: string // 一句話氛圍文案(選填,給點開資訊卡時當副標,不是文章全文)
}

export type LightKey = {
  time: string // 'HH:MM',關鍵時刻;相鄰兩個關鍵時刻之間線性插值
  skyTop: string // 天空上緣顏色
  skyBottom: string // 天空下緣(地平線)顏色
  fog: string
  sun: string // 太陽光顏色
  sunIntensity: number
  sunElevationDeg: number // 太陽仰角,夜間可以是月光(仰角低、顏色偏藍)
  sunAzimuthDeg: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  lanternGlow: number // 0~1,燈籠/窗戶自發光強度(夜晚高)
}

export type IslandLayout = {
  // 島的輪廓(頂視圖多邊形,順時針),島體會由它擠出成一塊厚地。
  outline: Pt[]
  topY: number // 最低層地面的表面高度(通常 0)
  // terraces:階梯式平台(九份是依山而建的山城,高處的步道與建築在上層)。每塊是一個頂視圖多邊形
  // 加上頂面高度 y;渲染層把它們擠出疊在島體上,形成層層往上的階地。不填 = 一整塊平地。
  terraces?: Array<{ outline: Pt[]; y: number; color?: string }>
  // sea:島外(或島邊低處)的海面,選填;九份的遠景是海,夜晚有海面反光。
  sea?: { y: number; color: string }
  thickness: number // 島的厚度(泥土層深度),島底可以參差
  // 河:一條蜿蜒的中線,寬度固定,畫成略低於地面的水面帶(要有流動感)。
  river: { points: Pt[]; width: number }
  // 散策步道:依序經過各站的折線(渲染層會平滑成曲線),旅人沿著它走。九份是依山而建的階梯山城,
  // 步道可以有高低(用 Pt 的第三個值不夠時,請在 docs/visual-plan.md 的契約建議說明)。
  path: { points: Pt[]; width: number }
  stops: StopAnchor[] // 四站,依文章順序
  scatter: Placement[] // 樹、石、燈籠、長椅等裝飾,不需要逐一精確,但要有疏密與群聚
  lighting: LightKey[] // 涵蓋 16:00 ~ 22:00 的傍晚到夜晚關鍵時刻(從日落前到燈籠全亮),可再加白天關鍵時刻供時間滑桿拖到白天;最後一筆會回接第一筆
  // 色票:地表與水的基本色(渲染層直接用);紅葉變化用 maple 模型自己的色票
  palette: { grass: string; grassAlt: string; dirt: string; water: string; waterDeep: string; path: string }
}
