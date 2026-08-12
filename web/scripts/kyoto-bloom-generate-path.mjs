// 產生 HomePage.tsx(原 KyotoExploreBloom.tsx)需要的三份路徑相關資料:
//   1. COORDS(節點座標陣列)
//   2. .map-path-ghost / #mapFill 兩個 <path> 共用的 d 屬性字串
//   3. nodeLenFractions(每個節點在路徑上的精確累積弧長比例)
//
// 這三份資料目前在 HomePage.tsx 裡是三處各自獨立的字面量(理由見該檔案
// COORDS/nodeLenFractions/兩個 <path> 宣告處的註解:SVG <path> 的 d
// 屬性只能是字面字串,COORDS 是 JS 邏輯要用的座標陣列,兩者無法在
// runtime 共用同一份而不用付出「把貝茲曲線重建演算法搬進瀏覽器」的
// 代價——這代價包含重新觸發已經修過一次的效能問題,見該檔案開頭
// COORDS 定義處關於 12000 次 getPointAtLength() 造成首次渲染卡頓的
// 說明)。故採用離線腳本產生、手動貼回三處字面量的做法,取代「三處
// 各自手改、只能靠人工對齊」。
//
// 用法:
//   1. 若要調整整體路徑走勢,先改下面的 ORIGINAL_D(手繪/設計端的原始
//      路徑,通常不需要改)或 N(節點數,須與 HomePage.tsx 的
//      STOPS.length 一致)。
//   2. node --experimental-vm-modules web/scripts/kyoto-bloom-generate-path.mjs
//      (純 Node.js 數學運算,不需要瀏覽器/DOM)
//   3. 把印出的三段輸出依序貼回 HomePage.tsx(具體行號請先在檔案裡搜尋
//      對應的變數/屬性名稱確認目前位置,行號會隨其他改動漂移,不寫死
//      在這裡):
//      - COORDS 陣列 → 取代 const COORDS 陣列字面量
//      - path d 屬性 → 取代 .map-path-ghost 與 #mapFill 兩個 <path> 的
//        d(兩處貼一樣的值)
//      - nodeLenFractions 陣列 → 取代 const nodeLenFractions 陣列字面量
//   4. 三處貼完後跑 npx tsc -b / npx vitest run 確認沒有型別/測試錯誤,
//      再實際在瀏覽器裡捲動確認視覺沒有跑掉。

// ---- 三次貝茲曲線基礎數學(純函式,不依賴瀏覽器/DOM/SVG API) ----

function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const x = mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0]
  const y = mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1]
  return [x, y]
}

function bezierDeriv(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const dx = 3 * mt ** 2 * (p1[0] - p0[0]) + 6 * mt * t * (p2[0] - p1[0]) + 3 * t ** 2 * (p3[0] - p2[0])
  const dy = 3 * mt ** 2 * (p1[1] - p0[1]) + 6 * mt * t * (p2[1] - p1[1]) + 3 * t ** 2 * (p3[1] - p2[1])
  return [dx, dy]
}

// 弧長 = ∫|B'(t)|dt,用 Gauss-Legendre 5 點數值積分——對三次貝茲曲線精度
// 已經很夠,不需要暴力切很多小段線性逼近(那正是原本造成首次渲染卡頓
// 的做法,離線腳本裡也刻意不重蹈覆轍)。
const GAUSS_NODES = [-0.9061798459, -0.5384693101, 0, 0.5384693101, 0.9061798459]
const GAUSS_WEIGHTS = [0.2369268851, 0.4786286705, 0.5688888889, 0.4786286705, 0.2369268851]

function bezierArcLength(p0, p1, p2, p3) {
  let sum = 0
  for (let i = 0; i < 5; i++) {
    const t = 0.5 * GAUSS_NODES[i] + 0.5
    const [dx, dy] = bezierDeriv(p0, p1, p2, p3, t)
    sum += GAUSS_WEIGHTS[i] * Math.hypot(dx, dy)
  }
  return sum * 0.5
}

// 用二分逼近找出「弧長走到 targetLen 時對應的 t」,再用 bezierPoint 拿座標
// (取代 SVG 的 getPointAtLength,純數學版本,離線執行不受此限)。
function pointAtArcLength(p0, p1, p2, p3, targetLen) {
  let lo = 0, hi = 1
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2
    let partial = 0
    const STEPS = 64
    let prev = bezierPoint(p0, p1, p2, p3, 0)
    for (let k = 1; k <= STEPS; k++) {
      const t = (k / STEPS) * mid
      const cur = bezierPoint(p0, p1, p2, p3, t)
      partial += Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
      prev = cur
    }
    if (partial < targetLen) lo = mid
    else hi = mid
  }
  return bezierPoint(p0, p1, p2, p3, (lo + hi) / 2)
}

function parsePath(d) {
  const tokens = d.match(/[MC][^MC]*/g)
  const start = tokens[0].slice(1).trim().split(',').map(Number)
  const segs = []
  let cur = start
  for (let i = 1; i < tokens.length; i++) {
    const nums = tokens[i].slice(1).trim().split(/[\s,]+/).map(Number)
    segs.push({ start: cur, c1: [nums[0], nums[1]], c2: [nums[2], nums[3]], end: [nums[4], nums[5]] })
    cur = [nums[4], nums[5]]
  }
  return segs
}

// ---- 設計端輸入 ----

// 原始手繪路徑(9 段貝茲曲線,逐字從最早的靜態 demo 頁 #mapFill 的 d 屬性
// 解析出來)。這是整條路徑視覺走勢(同一條 S 型蜿蜒山徑)的設計來源,
// 通常不需要更動——會變動的是下面的 N(節點數)。
const ORIGINAL_D = 'M110,-210 C130,-175 90,-145 110,-110 C130,-75 90,-45 110,-30 C130,-8 95,5 110,20 C140,80 100,140 150,190 C190,240 40,290 70,340 C100,390 160,440 130,490 C100,540 60,580 90,630 C120,680 160,710 140,760 C120,810 100,850 110,880'

// 節點數——須與 HomePage.tsx 的 STOPS.length 一致(見該檔案
// nodeLenFractions 附近的註解:兩者不同步會讓 nodeLenFractions[currentIdx]
// 讀到 undefined,一路悄悄污染成 NaN)。
const N = 8

// 新節點與原路徑之間,重建平滑貝茲曲線用的控制柄長度比例(取「弦長 ×
// 這個比例」當控制點到節點的距離)——0.6 是先前用瀏覽器版本試過幾種
// 比例、挑標準差(各段弧長的離散程度)最小的結果。
const HANDLE_FRAC = 0.6

// ---- 沿原始路徑,依弧長均勻切出 N 個新節點,並在每個節點估算切線方向 ----

const origSegs = parsePath(ORIGINAL_D)
const origLens = origSegs.map((s) => bezierArcLength(s.start, s.c1, s.c2, s.end))
const origTotalLen = origLens.reduce((a, b) => a + b, 0)

function segmentAtArcLength(targetLen) {
  let acc = 0
  for (let s = 0; s < origSegs.length; s++) {
    if (acc + origLens[s] >= targetLen - 1e-6 || s === origSegs.length - 1) {
      return { seg: origSegs[s], localTarget: Math.max(0, targetLen - acc) }
    }
    acc += origLens[s]
  }
}

function tangentAtArcLength(targetLen) {
  const { seg, localTarget } = segmentAtArcLength(targetLen)
  const STEPS = 200
  let bestT = 0, partial = 0
  let prev = bezierPoint(seg.start, seg.c1, seg.c2, seg.end, 0)
  for (let k = 1; k <= STEPS; k++) {
    const t = k / STEPS
    const cur = bezierPoint(seg.start, seg.c1, seg.c2, seg.end, t)
    partial += Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
    prev = cur
    if (partial >= localTarget) { bestT = t; break }
    bestT = t
  }
  const [dx, dy] = bezierDeriv(seg.start, seg.c1, seg.c2, seg.end, bestT)
  const mag = Math.hypot(dx, dy) || 1
  return [dx / mag, dy / mag]
}

const newNodes = []
const tangents = []
for (let i = 0; i < N; i++) {
  const targetLen = (i / (N - 1)) * origTotalLen
  const { seg, localTarget } = segmentAtArcLength(targetLen)
  const p = pointAtArcLength(seg.start, seg.c1, seg.c2, seg.end, localTarget)
  newNodes.push([+p[0].toFixed(2), +p[1].toFixed(2)])
  tangents.push(tangentAtArcLength(targetLen))
}

// ---- 用新節點 + 切線方向,重建平滑的三次貝茲曲線 ----

const newSegs = []
for (let i = 0; i < N - 1; i++) {
  const start = newNodes[i]
  const end = newNodes[i + 1]
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1])
  const handleLen = chord * HANDLE_FRAC
  const c1 = [+(start[0] + tangents[i][0] * handleLen).toFixed(2), +(start[1] + tangents[i][1] * handleLen).toFixed(2)]
  const c2 = [+(end[0] - tangents[i + 1][0] * handleLen).toFixed(2), +(end[1] - tangents[i + 1][1] * handleLen).toFixed(2)]
  newSegs.push({ start, c1, c2, end })
}

const newLens = newSegs.map((s) => bezierArcLength(s.start, s.c1, s.c2, s.end))
const newTotalLen = newLens.reduce((a, b) => a + b, 0)
const mean = newTotalLen / newLens.length
const stddev = Math.sqrt(newLens.reduce((a, l) => a + (l - mean) ** 2, 0) / newLens.length)

const newD = 'M' + newSegs[0].start.join(',') + ' ' +
  newSegs.map((s) => `C${s.c1[0]},${s.c1[1]} ${s.c2[0]},${s.c2[1]} ${s.end[0]},${s.end[1]}`).join(' ')

// ---- nodeLenFractions:直接沿用上面剛算好的 newSegs,不需要像原本兩支
// 分開的腳本那樣,把 newD 手動複製貼回當第二支腳本的輸入。 ----

const fractions = [0]
let acc = 0
for (const l of newLens) {
  acc += l
  fractions.push(acc / newTotalLen)
}

// ---- 輸出 ----

console.log('=== 原始路徑(9 段,設計來源) ===')
origLens.forEach((l, i) => console.log(`  seg ${i}: ${l.toFixed(2)}`))
console.log('  total:', origTotalLen.toFixed(2))

console.log('\n=== 新路徑段長(等弧長重分配後,驗證用) ===')
newLens.forEach((l, i) => console.log(`  seg ${i}: ${l.toFixed(2)}`))
console.log('  total:', newTotalLen.toFixed(2))
console.log('  mean:', mean.toFixed(2), ' stddev:', stddev.toFixed(2))

console.log('\n=== 1. COORDS(貼進 HomePage.tsx 取代 COORDS 陣列) ===')
console.log('const COORDS: [number, number][] = [')
for (let i = 0; i < newNodes.length; i += 4) {
  console.log('  ' + newNodes.slice(i, i + 4).map((n) => `[${n[0]}, ${n[1]}]`).join(', ') + ',')
}
console.log(']')

console.log('\n=== 2. path d 屬性(貼進兩個 <path> 的 d,兩處貼一樣的值) ===')
console.log(newD)

console.log('\n=== 3. nodeLenFractions(貼進 HomePage.tsx 取代 nodeLenFractions 陣列) ===')
console.log('[' + fractions.map((f) => f.toFixed(6)).join(', ') + ']')
