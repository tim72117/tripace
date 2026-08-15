import './JiufenHandDrawnMap.css';

// 手繪風示意地圖——跟 JiufenMap.tsx(Google Maps 真實地理座標版)並存比較
// 用,純靜態 SVG,不依賴 Maps API/API key。座標非精確地理投影,是依照
// 使用者截圖裡看到的九份實際地形(老街核心區密集、往東北到黃金博物館
// 較遠、往南到小金瓜露頭)重新排布的示意相對位置,山形輪廓用手繪等高線
// 筆觸表現,無法用 Google Maps styler 做出的紙張筆觸質感在這裡是強項。
const STOPS = [
  { index: '壱', name: '九份地名由來', x: 200, y: 210, stopIndex: 1 },
  { index: '参', name: '豎崎路', x: 235, y: 195, stopIndex: 3 },
  { index: '四', name: '輕便路', x: 260, y: 205, stopIndex: 4 },
  { index: '伍', name: '昇平戲院', x: 245, y: 225, stopIndex: 5 },
  { index: '柒', name: '重生', x: 220, y: 240, stopIndex: 7 },
  { index: '弐', name: '小金瓜露頭', x: 300, y: 340, stopIndex: 2 },
  { index: '陸', name: '黃金博物館', x: 430, y: 160, stopIndex: 6 },
] as const;

export function JiufenHandDrawnMap({ onSelect }: { onSelect?: (stopIndex: number) => void }) {
  return (
    <div className="jiufen-hand-map">
      <svg viewBox="0 0 520 400" role="img" aria-label="九份地點手繪示意圖">
        <defs>
          {/* fractalNoise 產生的雜訊經 colormatrix 轉為低對比灰階,疊在紙色
              底上模擬斑駁紙纖維——比純色平底更接近使用者要求的「古地圖
              感」,是純 CSS 做不到的效果(CSS 沒有可調頻率的雜訊產生器)。 */}
          <filter id="jiufen-hand-map-paper-noise" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.29  0 0 0 0 0.2  0 0 0 0.05 0" />
          </filter>
          {/* 邊角做舊暈影——徑向漸層由中心透明到邊緣泛褐,疊在最上層製造
              「紙張邊角受潮/氧化較深」的古地圖常見視覺效果。 */}
          <radialGradient id="jiufen-hand-map-vignette" cx="50%" cy="45%" r="75%">
            <stop offset="55%" stopColor="#6B5B42" stopOpacity="0" />
            <stop offset="100%" stopColor="#6B5B42" stopOpacity="0.35" />
          </radialGradient>
        </defs>

        <rect className="jiufen-hand-map-paper-base" x="0" y="0" width="520" height="400" />
        <rect x="0" y="0" width="520" height="400" filter="url(#jiufen-hand-map-paper-noise)" />

        {/* 山形等高線——三層同心不規則曲線疊出基隆山/大肚美人山的量體感,
            筆觸刻意帶手抖的不規則弧度(非正圓/正橢圓),模擬手繪地圖常見的
            等高線畫法。 */}
        <g className="jiufen-hand-map-contour">
          <path d="M120,80 C160,55 230,50 270,75 C320,95 340,140 320,180 C300,225 240,235 190,215 C140,195 95,160 90,120 C88,100 100,90 120,80Z" />
          <path d="M140,95 C175,75 225,72 255,92 C290,108 300,140 285,168 C268,198 220,205 185,190 C150,175 118,150 115,125 C113,110 122,102 140,95Z" />
          <path d="M160,110 C185,96 215,95 235,108 C258,120 262,142 250,158 C238,176 205,180 182,168 C160,157 142,140 142,122 C142,116 150,113 160,110Z" />
        </g>

        {/* 第二座山頭(大肚美人山)——同一組筆觸語言,體積略小,疊在基隆山
            東北側,對齊使用者截圖與地形描述裡「兩山夾聚落」的相對關係。 */}
        <g className="jiufen-hand-map-contour">
          <path d="M360,60 C395,40 445,42 470,68 C495,92 490,130 460,150 C428,172 380,168 355,142 C332,118 328,80 360,60Z" />
          <path d="M375,75 C400,60 435,62 452,82 C470,100 465,125 442,138 C420,152 388,148 372,128 C356,110 355,88 375,75Z" />
        </g>

        {/* 聚落區塊——老街核心區的不規則色塊(非幾何圖形),疊在山腳,表現
            沿等高線層疊而建的聚落型態。 */}
        <path
          className="jiufen-hand-map-settlement"
          d="M175,190 C205,178 250,180 275,195 C295,207 290,230 265,242 C240,255 195,252 175,235 C158,220 158,200 175,190Z"
        />

        {/* 山澗溪流——九份地區沒有大型河川,只有源自山區的小溪(如大竿林
            溪一類),用比道路更細、更曲折的藍綠色線條表現,從基隆山山腹
            蜿蜒而下流向東北方海岸,與主幹道路線交錯但不重疊,強化「聚落
            夾在山與海之間的谷地」的地形感。 */}
        <path
          className="jiufen-hand-map-river"
          d="M300,130 C310,155 295,175 305,200 C315,225 340,235 350,260 C360,285 345,305 355,330 C362,348 385,358 400,370"
        />
        <path
          className="jiufen-hand-map-river jiufen-hand-map-river--minor"
          d="M150,150 C160,175 148,195 158,220 C166,240 182,248 178,268"
        />

        {/* 道路——手繪蜿蜒線條,由西南(瑞芳方向)進入聚落,再向東北繞往
            金瓜石/黃金博物館,對齊 102 縣道實際走向的敘事(西南—東北)。 */}
        <path
          className="jiufen-hand-map-road"
          d="M40,320 C90,300 130,270 165,240 C185,222 195,205 210,190 C240,165 270,155 310,150 C350,145 390,150 420,140 C445,132 460,120 470,105"
        />

        {/* 街區內部路網——豎崎路(南北向階梯,聚落的垂直主軸)與基山街/
            輕便路(東西向平緩街道,沿山腰橫向延伸)交織,比主幹道路更細,
            表現聚落內部巷弄紋理,而不只是一條穿越性的聯外道路。 */}
        <g className="jiufen-hand-map-street-grid">
          <path d="M220,180 C222,195 224,210 226,225 C228,238 230,248 233,258" />
          <path d="M190,200 C210,198 232,197 255,199 C270,200 282,204 292,210" />
          <path d="M185,215 C208,213 230,213 252,217 C266,220 278,225 288,232" />
          <path d="M195,230 C215,232 235,235 252,242" />
        </g>
        <path
          className="jiufen-hand-map-road jiufen-hand-map-road--minor"
          d="M200,225 C230,235 260,238 285,230 C300,225 305,215 300,205"
        />

        {/* 海岸線暗示——畫面右下角一段波浪弧線,對齊「九份北方鄰海」的
            地形描述,並與上方溪流匯入點銜接,不畫完整海岸輪廓(不是這張
            圖的重點)。 */}
        <path className="jiufen-hand-map-coast" d="M330,370 C360,362 385,368 410,376 C435,384 460,380 490,372" />

        {STOPS.map((stop) => (
          <g
            key={stop.name}
            className="jiufen-hand-map-pin"
            transform={`translate(${stop.x}, ${stop.y})`}
            onClick={() => onSelect?.(stop.stopIndex)}
          >
            <circle r="12" />
            <text y="4" textAnchor="middle">{stop.index}</text>
            <text className="jiufen-hand-map-pin-label" y="24" textAnchor="middle">{stop.name}</text>
          </g>
        ))}

        {/* 暗角暈影疊在最上層,pointer-events: none(見 CSS)避免擋到下方
            站點標記的點擊。 */}
        <rect x="0" y="0" width="520" height="400" fill="url(#jiufen-hand-map-vignette)" className="jiufen-hand-map-vignette-rect" />
      </svg>
    </div>
  );
}
