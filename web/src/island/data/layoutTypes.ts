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
  // 貼著斜坡:物件的「上方」先繞 X、Z 軸傾斜(弧度,Euler XZ),再繞自己的上方轉 rotY。有填就視為刻意放在坡面上,
  // 不做「腳印等高」檢查。例如 60° 峭壁面朝 +z:[Math.PI / 3, 0]。
  tilt?: [number, number]
  // 腳底高度 y 是刻意指定的(例如石階模型的原點在最低一階、坡面比它高),不要被「y 低於地面就改成地面高度」修正掉。
  keepY?: boolean
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

// 斜坡的峭壁外觀:頂面用「輪廓上每隔 10/2^detail 一個點 + 內部抖動格點」做 Delaunay 剖分(detail 0~5,
// 越大稜面越碎),內部頂點依 seed 隨機往上長最多 amp,做出有菱角的岩面;輪廓上的點不動、往內依距離淡入,
// 與裙邊、相鄰地面不裂縫。陡面用 rockColor,平緩處用斜坡自己的色。
// 注意:heightAt(物件貼地用)不含這個起伏,畫面上的岩面最多比 heightAt 高 amp;輪廓建議是凸形(見 validateLayout)。
export type SlopeCrag = { seed: number; amp: number; detail: number; rockColor?: string }

// ---- 連續地形(高度場)----
// 有 layout.terrain 時,地面高度由它決定(取代 terraces/slopes 的疊層):
//   高度 = ramp + Σ features(bump/ridge) + noise,最後依序套用 pads(削平的平台)。
// 實作在 logic/heightfield.ts(純函式,heightAt 的唯一來源),網格在 three/terrainField.ts。
export type RampSpec = { from: Pt; to: Pt; y0: number; y1: number } // 沿 from→to 線性升高的基底斜面(兩端外夾住)
export type BumpSpec = { kind: 'bump'; x: number; z: number; rx: number; rz: number; rot?: number; height: number } // 平滑隆起(height<0 = 窪地)
export type RidgeSpec = { kind: 'ridge'; points: Array<[number, number, number]>; halfWidth: number } // 沿折線的山脊,[x, z, 該點的脊高]
export type PadSpec = { outline: Pt[]; y: number; blend: number; color?: string } // 削平平台:內部高度 = y,外圍 blend 格平滑接回
export type NoiseSpec = { amp: number; scale: number; seed: number } // 低頻起伏(振幅 amp,特徵尺寸 scale 格)
export type TerrainSpec = {
  ramp?: RampSpec
  features?: Array<BumpSpec | RidgeSpec>
  noise?: NoiseSpec
  pads?: PadSpec[]
  cell?: number // 地表網格邊長(預設 2 格;越小越細也越慢)
  // 地表顏色:草色取 palette.grass/grassAlt(隨高度漸變);beach 是低處(beachY 以下)、rock 是陡坡、soil 是側面土層(由上往下)
  colors?: { beach?: string; beachY?: number; rock?: string; soil?: string[] }
}

// 鏡頭覆蓋:不填就由引擎依島半徑推算(封面從南偏西、各站從站點東南上方看)。連續地形的島形狀不是圓,建議手寫。
export type LayoutCameraKey = { pos: [number, number, number]; target: [number, number, number] }
export type LayoutCamera = {
  cover?: LayoutCameraKey
  stops?: Array<LayoutCameraKey | null> // 依「島上顯示的第 i 站」對應;null/缺 = 用預設
}

export type IslandLayout = {
  // grid——世界格子規格(logic/world/grid.ts):地形與散落物依它分組做剔除、串流、LOD。不填 = 預設 32 m。
  grid?: { cellSize: number }
  // 島的輪廓(頂視圖多邊形,順時針),島體會由它擠出成一塊厚地。
  outline: Pt[]
  topY: number // 最低層地面的表面高度(通常 0)
  // terraces:階梯式平台(九份是依山而建的山城,高處的步道與建築在上層)。每塊是一個頂視圖多邊形
  // 加上頂面高度 y;渲染層把它們擠出疊在島體上,形成層層往上的階地。不填 = 一整塊平地。
  terraces?: Array<{ outline: Pt[]; y: number; color?: string }>
  // slopes:斜面(山坡)。每塊是頂視圖多邊形,地面高度沿 from→to 方向線性從 y0 升到 y1(方向線外夾在兩端)。
  // 與階地並列:任一點的高度取階地與斜坡裡最高者。兩端建議等於相鄰階地的高度,才不會有縫。
  slopes?: Array<{ outline: Pt[]; from: Pt; to: Pt; y0: number; y1: number; color?: string; crag?: SlopeCrag }>
  // terrain:連續地形(高度場),有填就取代 terraces/slopes 決定地面高度與地表網格(見上方 TerrainSpec)。
  // topY 仍是「最低地面」:高度場低於 topY 的地方一律夾在 topY(海岸的底)。
  terrain?: TerrainSpec
  camera?: LayoutCamera
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
