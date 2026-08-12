import { useEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import './KyotoExploreBloom.css'

// KyotoExploreBloom — 京都東山探索路線的捲動視差 demo,原本是獨立的純
// HTML/CSS/JS 靜態頁面(web/public/kyoto-demo-pages/kyoto-explore-bloom.html),
// 搬進 src/ 讓它能走 Vite dev server 的 HMR、日後可能取代 LandingPage.tsx。
//
// 這裡刻意不把互動邏輯重寫成宣告式的 React state/JSX——原本的邏輯是一組
// 已經仔細校準過的捲動數學(stopProgress 的分段公式、bloom 開合的三段式
// timing、cursor 沿 SVG path 的長度插值),核心價值就在那些調校好的數值與
// 時序本身,不在「用什麼方式渲染 DOM」。重寫成 React state 驅動的渲染只會
// 提高把時序調壞的風險,換不到實質好處——這裡沒有需要 React diffing 幫忙
// 管理的頻繁互動狀態,一次性掛載後靠 rAF 逐幀更新的命令式邏輯反而更貼近
// 它實際的運作方式。故整段邏輯原封不動包進 useEffect,只做兩個必要調整:
//   1. document.body.classList → rootRef 對應的元件根節點(不能繼續污染
//      全域 <body>,這個元件將來要能跟其他頁面共存,見 KyotoExploreBloom.css
//      開頭的 .kyoto-bloom scope 說明)。
//   2. 所有 querySelector/getElementById 改成從 rootRef.current 底下找,
//      避免撞到頁面上其他元件同樣 id 的元素(原始 HTML 是整頁獨佔,id
//      沒有這個顧慮;搬進元件後不能再假設 document 裡只有這一份)。
export function KyotoExploreBloom() {
  const rootRef = useRef<HTMLDivElement>(null)
  // theme:手動日夜間切換,寫進根元素的 data-theme 屬性——CSS 已支援
  // .kyoto-bloom[data-theme="dark"]/[data-theme="light"](原本只用來讓
  // 校準面板等未來情境可以強制指定主題,見 KyotoExploreBloom.css),沒有
  // data-theme 時預設跟隨系統的 prefers-color-scheme。初始值給 null
  // (跟隨系統),使用者按下切換鈕後才會有明確值,且只在按下當下才決定
  // 「跟現在系統顯示的相反」,不用一開始就去讀 matchMedia。
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null)
  // systemPrefersDark:theme 為 null(使用者還沒手動切換過)時,切換鈕的
  // 圖示/文字要知道系統目前實際顯示的是深色還是淺色,才能正確提示「按下
  // 去會變成怎樣」——用獨立的 useEffect 監聽 matchMedia 變化(使用者可能
  // 在頁面開著的當下切換系統設定),不是只在掛載時讀一次。
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const isCurrentlyDark = (t: 'dark' | 'light' | null) => (t === null ? systemPrefersDark : t === 'dark')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const PHOTO_DATA: Record<string, { full: string; thumb: string }> = {
      lmk_8afe0eb1be4d: { full: '/kyoto-demo/n1.jpg', thumb: '/kyoto-demo/n1-thumb.jpg' },
      lmk_5e7f446885a2: { full: '/kyoto-demo/n2.jpg', thumb: '/kyoto-demo/n2-thumb.jpg' },
      lmk_950b58252886: { full: '/kyoto-demo/n3.jpg', thumb: '/kyoto-demo/n3-thumb.jpg' },
      lmk_702c093af606: { full: '/kyoto-demo/n4.jpg', thumb: '/kyoto-demo/n4-thumb.jpg' },
      lmk_a165a5604833: { full: '/kyoto-demo/n5.jpg', thumb: '/kyoto-demo/n5-thumb.jpg' },
      lmk_fd16955fa008: { full: '/kyoto-demo/n6.jpg', thumb: '/kyoto-demo/n6-thumb.jpg' },
      lmk_1914e13ef52e: { full: '/kyoto-demo/n7.jpg', thumb: '/kyoto-demo/n7-thumb.jpg' },
    }

    // node 0 是佔位的「起點」標記,坐落在路徑最前段的引導曲線上——是一個
    // 真正的 stop(有自己的文字區塊、跟著 stopProgress 走時序),而非特殊
    // case 的虛擬節點,故下面通用寫給 N 個 stop 的路徑繪製/cursor 移動/
    // 平移機制不需要為它額外分支。它沒有照片,故 bloom 明確跳過(見 dotShown)。
    //
    // 這組座標是沿著原始手繪路徑的整體走勢、依弧長重新均勻切出的 8 個點
    // (純數學運算:三次貝茲曲線公式 + Gauss-Legendre 數值積分算弧長,
    // 二分逼近找每個等分點對應的座標,不依賴瀏覽器 API)——原始手繪座標
    // 讓 9 段貝茲曲線的弧長從 55~187 不等(node 0→1 之間甚至用了 3 段
    // 貝茲曲線銜接,單這一段就佔了 243 的弧長),下面 nodeLenFractions
    // 只能用暴力取樣(每個節點 1500 次 getPointAtLength)才找得到節點在
    // 路徑上的精確比例位置,總計 8×1500=12000 次同步呼叫,是首次渲染卡頓
    // ~2 秒的根因。改成等弧長分布後,節點在路徑上的比例天生就是
    // i/(N-1),不需要任何取樣。保留原始路徑的視覺走勢(同一條 S 型蜿蜒
    // 山徑,起點/終點座標不變),只是 8 個節點在這條走勢上的間距重新
    //分配為大致均勻。
    const COORDS: [number, number][] = [
      [110, -210], [104.33, -43.52], [122.68, 120.29], [111.7, 266.78],
      [116.8, 406], [87.39, 560.25], [142.35, 714.38], [110, 880],
    ]
    // viewBox="0 -230 220 1130" — node 0 之前的引導曲線需要 y=0 以上的空間,
    // 故 viewBox 的 y 原點往上位移;任何要把 svg 座標系的 y 轉成螢幕像素的
    // 地方都要先減去這個值。
    const VIEWBOX_MIN_Y = -230

    const STOPS: { id: string | null; index: string; kind: string; name: string; desc: string }[] = [
      { id: null, index: '', kind: '起點', name: '東山山麓',
        desc: '東山是花崗岩隆起的丘陵，山麓緩坡與湧泉，是歷代寺院選址於此的物理基礎——地形逼出了清水寺的懸空舞台造，參拜人潮踩出了產寧坂的坡道商店街，明治年間的土地政策把寺院境內地變成了圓山公園，而八坂神社門前的參拜人流，最終孕育出祇園的茶屋與藝妓文化。地質、信仰、商業、人文，是同一條因果鏈，接下來就沿著這條路線一一走過。' },
      { id: 'lmk_8afe0eb1be4d', index: '壱', kind: '地理', name: '清水寺',
        desc: '778年僧延鎮於音羽山中腹結庵祀觀音，798年坂上田村麻呂建佛殿成為敕願寺。山中湧泉音羽の滝自創建以來持續湧流——陡峭的懸崖地形，逼出了「舞台造」這種懸空木構工法，讓正殿得以立於山腹而不需削平地形。' },
      { id: 'lmk_5e7f446885a2', index: '弐', kind: '路徑', name: '產寧坂・二年坂',
        desc: '清水寺參拜者必經的山麓坡道——地形限制下唯一可行的參道，因而自然發展成帶狀商店街，1976年指定為重要傳統的建造物群保存地區。人潮沿著地形走出的這條路，成了整條路線的空間骨架。' },
      { id: 'lmk_950b58252886', index: '参', kind: '地標', name: '八坂の塔（法観寺）',
        desc: '由出土瓦當樣式推斷創建可溯及7世紀。塔身立於山麓緩坡，在周邊低矮町家群中格外醒目，成為東山天際線的視覺地標——也是產寧坂北端通往祇園途中，一個明確的方向指標。' },
      { id: 'lmk_702c093af606', index: '四', kind: '寺院', name: '高台寺',
        desc: '1606年豐臣秀吉正室北政所（寧寧）為弔念秀吉建立，德川家康因政治考量提供鉅額資助。與清水寺、八坂の塔同屬沿東山山麓分布的寺院系列——地形宜建寺的邏輯，在這裡延續。' },
      { id: 'lmk_a165a5604833', index: '伍', kind: '轉型', name: '圓山公園',
        desc: '1871年明治神佛分離政策下，原屬八坂神社、雙林寺等的境內地被收公；1886年開設為京都第一座近代公園。這片土地從寺院境內轉為公共空間，正是承接了前面幾座寺院所留下的空間脈絡。' },
      { id: 'lmk_fd16955fa008', index: '陸', kind: '信仰', name: '八坂神社',
        desc: '社傳天神降臨於東山山麓的祇園林，選址與山麓森林直接相關。祇園祭起源可溯及869年的疫病祈禳，970年左右成為固定年度祭典——香火鼎盛的參拜人潮，即將沿著神社正門向外匯聚。' },
      { id: 'lmk_1914e13ef52e', index: '柒', kind: '人文', name: '祇園・花見小路',
        desc: '江戶初期作為八坂神社參拜與賞花客的休憩茶屋聚落發展，水茶屋逐漸轉為夜間營業的お茶屋，藝妓文化由此形成。地形決定了寺院的位置，信仰帶來了人潮，人潮聚集出了茶屋——最終，長成了獨特的人文藝能。' },
    ]

    const N = STOPS.length

    // ---- build map nodes ----
    const nodesGroup = root.querySelector('#mapNodes')!
    STOPS.forEach((s, i) => {
      const [x, y] = COORDS[i]
      const clipId = `clip-${i}`
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('class', 'map-node')
      g.dataset.node = String(i)
      // 佔位的起點標記(s.id === null)沒有照片——只有一個普通的點 + 標籤,
      // 沒有縮圖/光環那些裝飾。
      g.innerHTML = s.id
        ? `
        <defs><clipPath id="${clipId}"><circle cx="${x}" cy="${y}" r="18"/></clipPath></defs>
        <circle class="ring" cx="${x}" cy="${y}" r="14"/>
        <image class="thumb" x="${x - 18}" y="${y - 18}" width="36" height="36" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" href="${PHOTO_DATA[s.id].thumb}"/>
        <circle class="thumb-ring" cx="${x}" cy="${y}" r="18"/>
        <circle class="dot" cx="${x}" cy="${y}" r="4"/>
        <text class="label" x="${x + 26}" y="${y + 4}">${s.name}</text>
      `
        : `
        <circle class="dot" cx="${x}" cy="${y}" r="4"/>
        <text class="label" x="${x + 26}" y="${y + 4}">${s.name}</text>
      `
      nodesGroup.appendChild(g)
    })
    const mapNodes = nodesGroup.querySelectorAll<HTMLElement>('.map-node')
    const mapCursor = root.querySelector<SVGCircleElement>('#mapCursor')!
    const mapCaption = root.querySelector<HTMLElement>('#mapCaption')!
    const mapWindow = root.querySelector<HTMLElement>('.map-window')!
    const mapSvg = root.querySelector<SVGSVGElement>('#mapSvg')!
    const fillPath = root.querySelector<SVGPathElement>('#mapFill')!
    const totalLen = fillPath.getTotalLength()
    fillPath.style.strokeDasharray = String(totalLen)
    fillPath.style.strokeDashoffset = String(totalLen)

    // 每個 node 沿路徑總長度的精確累積弧長比例(0..1)——寫死的常數,不是
    // i/(N-1) 這種假設等長分布的簡化值。COORDS 這組座標雖然是依弧長重新
    // 均勻切出來的(見 COORDS 定義處的說明),但用平滑切線重建貝茲曲線後,
    // 9 段實際弧長仍有約 ±1.5% 的差異(161.9~180.0,不是完全相等)——這組
    // 常數是用同一套三次貝茲弧長公式(Gauss-Legendre 數值積分,見
    // compute-fractions.mjs 的驗證腳本,不依賴瀏覽器 API)對 SVG path 的
    // 9 段實際弧長精確算出來的累積比例,紅點斷點因此精確對齊路徑上的真實
    // 弧長位置,而非略有偏差的等分近似值。原本用 1500 次取樣 × 8 個節點
    // (共 12000 次 getPointAtLength 同步呼叫)在執行期逼近這個值,是首次
    // 渲染卡頓 ~2 秒的根因,現在是編譯期就算好的常數,不需要任何執行期計算。
    const nodeLenFractions = [0, 0.145927, 0.284204, 0.418973, 0.556757, 0.702015, 0.850111, 1]

    // ---- build right column: 每個 stop = 文字區塊。手機版跟桌面版現在
    // 共用同一套機制——單一浮動 .bloom-photo 圖層跟著地圖 cursor 位置
    // 展開/收合(見下方),不再是手機版各自一張內嵌在文字下方的靜態照片。
    // 版面方向從「地圖在左、文字在右」改成「地圖在上、文字在下」(見
    // KyotoExploreBloom.css 的 @media (max-width: 900px) 區塊),但兩種
    // 螢幕尺寸的 DOM 結構、進退場動畫邏輯完全一致,只有 bloom 圖層的錨點
    // 計算依螢幕寬度分支(見 update() 的 bloom 段落)。
    const stopsCol = root.querySelector<HTMLElement>('#stopsCol')!
    STOPS.forEach((s, i) => {
      const el = document.createElement('article')
      el.className = 'stop'
      el.dataset.node = String(i)
      el.innerHTML = `
      <div class="stop-text">
        <div class="stop-kicker">${s.index ? `<span class="stop-index">${s.index}</span>` : ''}<span class="stop-kind">${s.kind}</span></div>
        <h3 class="stop-name">${s.name}</h3>
        <p class="stop-desc">${s.desc}</p>
        <div class="stop-hint">
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v9M4.5 9L8 12.5 11.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          繼續往下看看這裡
        </div>
      </div>
    `
      stopsCol.appendChild(el)
    })
    const stopEls = stopsCol.querySelectorAll<HTMLElement>('.stop')

    // ---- progress rail ----
    const rail = root.querySelector<HTMLElement>('#progressRail')!
    STOPS.forEach((_, i) => {
      const d = document.createElement('div')
      d.className = 'progress-dot'
      d.dataset.node = String(i)
      rail.appendChild(d)
    })
    const railDots = rail.querySelectorAll<HTMLElement>('.progress-dot')

    // mobileMQ:桌面/手機版行為分支共用的判斷(見下方 text reveal、
    // updateIntroFade),往前提到這裡是因為 textIO/updateTextFade 兩處
    // 都需要在定義當下就查得到目前是否為手機版寬度。
    const mobileMQ = window.matchMedia('(max-width: 900px)')

    // ---- text reveal (per stop) ----
    // 進場:一進視窗(交集比例達 35%)就淡入,交給 IntersectionObserver 做,
    // 不需要每幀捲動都重算——這件事只在「有沒有交集」這個布林狀態改變時
    // 才需要動作,IntersectionObserver 正是為這種情境設計的,比在
    // update() 裡每幀重複判斷更省事。
    //
    // 桌面版:進場、退場都交給 IntersectionObserver 的 isIntersecting——
    // 一離開視窗(不論上緣或下緣)就淡出,這是原本就有的行為,維持不變。
    //
    // 手機版:進場一樣用 isIntersecting,但退場改成在 update() 裡依「文字
    // 區塊是否已經捲到視窗上半部」判斷(見下方 updateTextFade),而不是
    // 「完全離開視窗才淡出」——這是使用者針對手機版明確要求的效果("手機
    // 板的是要往下滑動時文字移動到上半部分時淡出"),不套用到桌面版(曾
    // 誤把這段邏輯套到所有寬度,導致桌面版退場時機被意外改掉,見下方
    // matchMedia 判斷)。IntersectionObserver 只在交集狀態「改變」時觸發,
    // 無法連續追蹤元素目前在視窗的哪個位置,故手機版的退場判斷移到
    // update() 這個逐幀執行的既有迴圈裡處理,textIO 在手機版只負責加上
    // text-in、不負責移除。
    const textIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (mobileMQ.matches) {
          if (entry.isIntersecting) entry.target.classList.add('text-in')
        } else {
          entry.target.classList.toggle('text-in', entry.isIntersecting)
        }
      })
    }, { threshold: 0.35 })
    stopEls.forEach((s) => textIO.observe(s))
    // updateTextFade:手機版專屬的退場判斷——文字區塊中心點一旦捲過視窗
    // 垂直中心線(即將進入上半部)就移除 text-in、開始淡出,不必等到完全
    // 離開視窗上緣。只處理「移除」,不處理「加上」(那是上面
    // IntersectionObserver 的職責),故往回捲、文字中心點回到視窗下半部
    // 時,text-in 不會在這裡被重新加上——要重新看到它淡入,得等它整個
    // 離開視窗、再重新進場一次(符合「進場只在真正重新進入視窗時觸發」的
    // 原意)。桌面版直接 no-op,退場完全交回 IntersectionObserver 處理。
    function updateTextFade() {
      if (!mobileMQ.matches) return
      const vh = window.innerHeight
      stopEls.forEach((el) => {
        const rect = el.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        if (centerY < vh / 2) el.classList.remove('text-in')
      })
    }

    // ---- unified scroll-driven update: 每個 stop 一個 0→1 的 progress 數字,
    // 同時驅動地圖 cursor 的位置「跟」bloom 照片——兩者是同一個底層數值的
    // 兩種效果,而不是各自獨立計時、可能彼此漂移的動畫。以文字區塊自己的
    // 位置驅動——cursor 必須在介紹文字開始出現的那一刻就開始移動(bloom
    // 也要開始長大),不能晚一拍。
    const textBlocks = Array.from(stopEls).map((el) => el.querySelector<HTMLElement>('.stop-text')!)
    const bloomEl = root.querySelector<HTMLElement>('#bloomPhoto')!
    const bloomImg = root.querySelector<HTMLImageElement>('#bloomImg')!
    let bloomStopIdx = -1 // 只在目標 stop 改變時才重新賦值 img src

    // 每個 stop 自己的 0→1 progress 拆成三段:
    //   0 → ARRIVE_AT     : 純移動——cursor 沿路徑前進，其餘什麼都不顯示，
    //                        結束時 cursor 真正抵達該 node(這是「抵達」)。
    //   ARRIVE_AT → BLOOM_AT : 點立刻開始展開成大照片(不先停頓)，用緩動
    //                        讓它一開始展開得快、接近 BLOOM_AT 時變慢。
    //   BLOOM_AT → 1       : 照片上移+淡出；一旦這個 stop 的 progress 到 1
    //                        就前進到下一個 node。
    const ARRIVE_AT = 0.4
    const BLOOM_AT = 0.78

    // progress 0 = 文字區塊還在視窗下方(什麼都還沒顯示)；
    // progress 1 = 已經捲到照片(在同一個文字區塊更下方)抵達完全展開的位置。
    // START_FRAC/END_FRAC 暴露成可即時調整的全域變數(不是寫死常數)，讓下面
    // 的校準面板可以調整並立即看到效果，再回填這兩個數字。
    let startFrac = 0.95
    let endFrac = 0.1

    // 這個 stop 自己 0→1 progress 所跨的捲動「距離」，是從它自己算出的
    // 高度(stopEls[i].offsetHeight)推導出來，而非固定的 vh 倍數——一個
    // 較短的 stop(例如「起點」佔位項，尤其手機版沒有照片)捲過所需的像素
        // 比長的 stop 少，若不這樣算，短 stop 的 cursor 移動窗口在真實捲動
    // 距離上可能幾乎是零，即使 ARRIVE_AT/BLOOM_AT 是以「這個 stop 捲完
    // 要花多少距離」的分數表示——cursor 在短 stop 上會顯得幾乎不動，卻在
    // 長 stop 上飛快跑過。乘上 stop 自己的高度，讓每個 stop 的 progress
    // 0→1 都對應到跟它自己內容成比例的捲動距離，配速才會跟畫面上實際
    // 呈現的內容吻合，而非一個武斷的 vh 窗口。
    function stopProgress(i: number): number {
      const r = textBlocks[i].getBoundingClientRect()
      const stopHeight = Math.max(1, stopEls[i].offsetHeight)
      const vh = window.innerHeight
      const start = vh * startFrac
      const end = start - stopHeight * (startFrac - endFrac)
      return Math.max(0, Math.min(1, (start - r.top) / (start - end)))
    }

    let svgScale = 1
    function measureScale() {
      // 渲染出來的像素高度 ÷ viewBox 高度(1130)——把 cursor 的 svg 座標系
      // y 轉成螢幕像素，讓平移變換能把它置中。
      svgScale = mapSvg.getBoundingClientRect().height / 1130
    }

    let ticking = false

    function update() {
      ticking = false
      updateTextFade()

      const progresses = STOPS.map((_, i) => stopProgress(i))

      // 「目前」的 stop 是第一個還沒完全展開的
      let currentIdx = N - 1
      let currentP = progresses[N - 1]
      for (let i = 0; i < N; i++) {
        if (progresses[i] < 1) { currentIdx = i; currentP = progresses[i]; break }
      }

      // travelP 是 currentP 重新縮放，讓 CURSOR 在 ARRIVE_AT(而非 1.0)就
      // 走完抵達這個 node 的旅程——剩下的區間(ARRIVE_AT→1)是「回落」階段，
      // cursor 就停在該 node，同時 bloom 照片縮回去，對應這整套機制建立
      // 在的「接近/抵達/回落」順序。
      const travelP = Math.min(currentP / ARRIVE_AT, 1)

      // 在前一個 node 跟這個 node 之間，用長度分數插值出 cursor 位置——
      // node 0 現在是路徑最開頭的真實佔位「起點」stop，這裡不需要任何
      // 特殊 case:同一套機制均一地套用到所有 N 個 stop。
      const segStart = currentIdx > 0 ? nodeLenFractions[currentIdx - 1] : 0
      const segEnd = nodeLenFractions[currentIdx]
      const cursorFrac = segStart + (segEnd - segStart) * travelP

      // node 狀態:passed(已抵達且被取代)、here(已抵達——bloom 已經有意義地
      // 長大，而非還在「途中」)
      mapNodes.forEach((n) => {
        const ni = Number(n.dataset.node)
        if (ni < currentIdx) {
          n.classList.add('passed'); n.classList.remove('here')
        } else if (ni === currentIdx) {
          n.classList.remove('passed')
          n.classList.toggle('here', travelP >= 0.7)
        } else {
          n.classList.remove('passed', 'here')
        }
      })

      // cursor 位置 + 已繪製的路徑筆畫——從這個 stop 自己的 progress 一開始
      // (currentP > 0)就啟動，每個 stop(含索引 0 的佔位起點標記)規則相同。
      const hasStarted = currentIdx > 0 || currentP > 0.001
      const pt = fillPath.getPointAtLength(totalLen * cursorFrac)
      mapCursor.setAttribute('cx', String(pt.x))
      mapCursor.setAttribute('cy', String(pt.y))
      mapCursor.style.opacity = hasStarted ? '1' : '0'
      fillPath.style.strokeDashoffset = String(hasStarted ? totalLen * (1 - cursorFrac) : totalLen)

      // 平移 svg 讓 cursor 停在視窗自己的垂直中心——這就是路徑能捲過一個
      // 固定視窗的效果。viewBox 從 y=-230 開始，故平移前要先減去這個偏移，
      // 否則平移量會整整偏差這個值。
      const windowH = mapWindow.clientHeight
      const cursorPxY = (pt.y - VIEWBOX_MIN_Y) * svgScale
      const translateY = windowH / 2 - cursorPxY
      mapSvg.style.transform = `translateY(${translateY}px)`

      railDots.forEach((d) => d.classList.toggle('active', Number(d.dataset.node) === currentIdx))
      mapCaption.textContent = `${STOPS[currentIdx].kind} · ${STOPS[currentIdx].name}`

      // ---- bloom 照片，每個 stop 三拍——這裡的一切都是 currentP 的純函式，
      // 每一幀都重新算，沒有已提交的非同步狀態(沒有 CSS transition、沒有
      // requestAnimationFrame 記憶值):往回捲會把每個公式反向跑一遍，
      // 剛好落在正向那次在同一個 scrollY 會產生的視覺狀態。曾試過用
      // transition 驅動回落，但捲動方向逆轉時一直壞掉(一個進行中的 0.7s
      // 動畫沒有明確的「目前值」可以反向接續)，故現在回落跟其他每一拍
      // 一樣，直接由 currentP 驅動。
      //   currentP < ARRIVE_AT        → 什麼都不顯示(純移動)
      //   ARRIVE_AT ≤ p ≤ BLOOM_AT    → 點立刻開始展開成大照片(不先停頓)，
      //                                  緩動先快後慢(clip-path 光圈從
      //                                  中心展開)
      //   BLOOM_AT < p ≤ 1            → clip-path 光圈反向收回去(跟展開
      //                                  時的動作互為鏡像)同時淡出，直接
      //                                  依 currentP 落在這個區間的多深
      //                                  來決定收回/淡出的程度，改由捲動
      //                                  位置而非計時器驅動。
      // 佔位的起點 stop(id === null)沒有照片——bloom 對它永遠不顯示，
      // 只有它的文字跟移動中的 cursor。
      const dotShown = hasStarted && currentP >= ARRIVE_AT && STOPS[currentIdx].id !== null
      // 展開從 dotShown 變 true 的那一刻立即開始(不先停頓)，到 BLOOM_AT
      // 時完全展開——緩動讓它一開始展開快、接近尾聲變慢，而非線性掃過。
      const bloomLinear = !dotShown ? 0
        : currentP <= BLOOM_AT ? (currentP - ARRIVE_AT) / (BLOOM_AT - ARRIVE_AT)
        : 1
      const bloomT = 1 - Math.pow(1 - bloomLinear, 3)
      // 回落一旦 bloomLinear 到 1 就立即開始(目前 BLOOM_AT 沒有停頓/暫停)。
      const recedeT = !dotShown || currentP <= BLOOM_AT ? 0
        : (currentP - BLOOM_AT) / (1 - BLOOM_AT)
      // ease-out cubic——大致對應 .stop-text 自己 cubic-bezier(0.22, 1, 0.36, 1)
      // 進場的漸緩手感，不需要真的用一個計時的 transition 產生它。
      const recedeEase = 1 - Math.pow(1 - recedeT, 3)

      // 標題在「剛好釘在 BLOOM_AT 的停留窗口」(bloomT 完全展開、回落還沒
      // 開始)取用強調色——是文字自己對照片同一段停頓的視覺回應。
      const inHold = dotShown && bloomT >= 1 && recedeT === 0
      stopEls.forEach((el, i) => el.classList.toggle('in-hold', i === currentIdx && inHold))

      if (dotShown) {
        if (bloomStopIdx !== currentIdx) {
          bloomStopIdx = currentIdx
          const photo = PHOTO_DATA[STOPS[currentIdx].id!]
          bloomImg.src = photo.full
          bloomImg.alt = STOPS[currentIdx].name
        }
        // cursor 在螢幕上的位置:svg 被平移讓它的 y 永遠落在視窗自己的垂直
        // 中心(見上面的 translateY)；x 沒有被平移，故只是 svg 座標系 x
        // 乘上 svgScale。
        const mapRect = mapWindow.getBoundingClientRect()
        const anchorX = mapRect.left + pt.x * svgScale
        const anchorY = mapRect.top + windowH / 2

        let maxW: number
        let maxH: number
        if (mobileMQ.matches) {
          // 手機板是上下配置(地圖 sticky 釘在上方，文字欄在下方隨頁面
          // 捲動)，沒有桌面板那種「絕不能越過旁邊文字欄」的左右邊界問題
          // ——bloom 照片改為以 map-window 自己的可視範圍為界，展開時
          // 撐滿這個 sticky 區塊的寬高，讀起來像「地圖本身在這一刻放大
          // 成一張照片」，而非desktop 那種「從地圖往螢幕中心長出來」。
          const maxByWidth = mapRect.width - 16
          const maxByHeight = (mapRect.height - 16) * 0.8
          maxW = Math.max(40, Math.min(maxByWidth, maxByHeight / 1.25))
          maxH = maxW * 1.25
        } else {
          // 限制展開幅度，讓它朝螢幕中心延伸但絕不越過文字欄——每一幀都
          // 量測文字欄實際的左邊界，而非寫死 grid 自己的 380px+5vw 間距，
          // 這樣在斷點/縮放時仍然正確。
          const stopsColRect = stopsCol.getBoundingClientRect()
          const maxByText = 2 * (stopsColRect.left - 28 - anchorX)
          const maxByLeftEdge = 2 * (anchorX - 12)
          maxW = Math.max(40, Math.min(560, maxByText, maxByLeftEdge))
          maxH = maxW * 1.25
        }

        // 元素本身從 dotShown 為 true 的那一刻就停在它最終的大小與位置——
        // 它自己的方框不再變大變小。讀起來是「小點→大照片→縮回小點同時
        // 淡出」的效果:展開階段(bloomT)clip-path 光圈從中心向外打開,
        // 罩住一張已經全尺寸的照片,不透明度全程 1;回落階段(recedeEase)
        // 光圈反向收回去(跟展開動作互為鏡像),同時不透明度跟著同一個
        // recedeEase 從 1 降到 0——遮罩收合與淡出並列發生,不是取代關係,
        // 純遮罩收合到最小(縮圖大小)時仍是一個實心小圓,若不搭配淡出,
        // 回落結束的瞬間會有一個仍然不透明的小圓片突然消失，不夠柔和。
        bloomEl.style.left = `${anchorX - maxW / 2}px`
        bloomEl.style.top = `${anchorY - maxH / 2}px`
        bloomEl.style.width = `${maxW}px`
        bloomEl.style.height = `${maxH}px`
        bloomEl.style.borderRadius = '8px'
        bloomEl.style.opacity = String(1 - recedeEase)
        // 半徑用絕對 px(不是 %)，讓遮罩一開始/最終收回的大小明確等於地圖
        // node 自己縮圖圓的大小(svg 單位 r=18，經 svgScale 轉成螢幕 px)
        // ——bloom 真正讀起來像「就是那個點長大、最後縮回同一個點」。
        // 百分比 clip-path 半徑依規範是相對 sqrt(w²+h²)/√2 解析，不是
        // width/2，故在 maxH > maxW(1.25 比例)時，百分比起點會明顯大於它
        // 該匹配的縮圖，px 完全避開這個問題。展開/回落共用同一個
        // thumbRadiusPx↔fullRadiusPx 區間:bloomT 從 0→1 走一趟展開，
        // recedeEase 從 0→1 再走一趟回程(1 - recedeEase 從 1 縮回 0)，
        // 兩段各自獨立驅動、不互相影響彼此的緩動曲線。
        const thumbRadiusPx = 18 * svgScale
        const fullRadiusPx = Math.sqrt(maxW * maxW + maxH * maxH) / 2
        const openT = recedeT > 0 ? 1 - recedeEase : bloomT
        const clipRadiusPx = thumbRadiusPx + openT * (fullRadiusPx - thumbRadiusPx)
        bloomEl.style.clipPath = `circle(${clipRadiusPx}px at 50% 50%)`
      } else {
        bloomEl.style.opacity = '0'
      }
    }

    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update) }
    }
    measureScale()
    window.addEventListener('scroll', onScroll, { passive: true })
    const onResize = () => { measureScale(); onScroll() }
    window.addEventListener('resize', onResize)
    update()

    const startBtn = root.querySelector<HTMLButtonElement>('#startBtn')!
    const onStartClick = () => {
      root.querySelector('#explore')?.scrollIntoView({ behavior: 'smooth' })
    }
    startBtn.addEventListener('click', onStartClick)

    // ---- calibration panel (dev tool) ----
    // 校準模式是開發時用來調 START_FRAC/END_FRAC 的工具，見下方 JSX 裡
    // {import.meta.env.DEV && (...)} 包起來的面板——正式環境完全不渲染
    // 這個 UI，故這裡的事件綁定只在對應 DOM 元素真的存在時才執行。
    let cleanupCalib: (() => void) | undefined
    const toggle = root.querySelector<HTMLButtonElement>('#calibToggle')
    if (toggle) {
      const panel = root.querySelector<HTMLElement>('#calibPanel')!
      const startRange = root.querySelector<HTMLInputElement>('#startRange')!
      const startNum = root.querySelector<HTMLInputElement>('#startNum')!
      const endRange = root.querySelector<HTMLInputElement>('#endRange')!
      const endNum = root.querySelector<HTMLInputElement>('#endNum')!
      const samplesEl = root.querySelector<HTMLElement>('#calibSamples')!
      const suggestEl = root.querySelector<HTMLElement>('#calibSuggest')!
      const outputEl = root.querySelector<HTMLTextAreaElement>('#calibOutput')!
      const copyBtn = root.querySelector<HTMLButtonElement>('#calibCopy')!
      const clearBtn = root.querySelector<HTMLButtonElement>('#calibClear')!
      const mapNodesEl = root.querySelector<HTMLElement>('#mapNodes')!

      let calibOn = false
      let samples: { nodeIndex: number; name: string; top: number }[] = []

      function syncFracInputs(which: 'start' | 'end') {
        if (which === 'start') { startNum.value = startRange.value; startFrac = parseFloat(startRange.value) }
        else { endNum.value = endRange.value; endFrac = parseFloat(endRange.value) }
        onScroll()
      }
      const onStartRangeInput = () => syncFracInputs('start')
      const onEndRangeInput = () => syncFracInputs('end')
      const onStartNumChange = () => { startRange.value = startNum.value; syncFracInputs('start') }
      const onEndNumChange = () => { endRange.value = endNum.value; syncFracInputs('end') }
      startRange.addEventListener('input', onStartRangeInput)
      endRange.addEventListener('input', onEndRangeInput)
      startNum.addEventListener('change', onStartNumChange)
      endNum.addEventListener('change', onEndNumChange)

      const onToggleClick = () => {
        calibOn = !calibOn
        toggle.classList.toggle('active', calibOn)
        panel.classList.toggle('open', calibOn)
        root.classList.toggle('calib-mode', calibOn)
      }
      toggle.addEventListener('click', onToggleClick)

      // 校準時點一個 node，記錄該 stop 文字區塊「目前」的 bounding-rect
      // top——也就是「這個捲動位置，這個 stop 的 progress 應該讀作 1.0」
      // (對應 stopProgress 定義「完全展開」的方式)。
      const onNodesClick = (e: Event) => {
        if (!calibOn) return
        const g = (e.target as HTMLElement).closest<HTMLElement>('.map-node')
        if (!g) return
        const i = Number(g.dataset.node)
        const top = textBlocks[i].getBoundingClientRect().top
        samples.push({ nodeIndex: i, name: STOPS[i]?.name ?? `#${i}`, top })
        render()
      }
      mapNodesEl.addEventListener('click', onNodesClick)

      function linearFit() {
        // stopProgress: p = (start - top) / (start - end)，每筆樣本都是
        // 使用者判斷該 stop p≈1 的那一刻記錄的——故每筆樣本給出一個方程式:
        // start - top ≈ start - end，也就是 top ≈ end。換句話說，每筆記錄
        // 的 top 本身就是 END_FRAC*vh 的直接估計值。START_FRAC 無法單靠
        // 「抵達」點反推(它只影響動作開始得多早，不影響結束在哪)——故保留
        // 滑桿目前設定的 START_FRAC，只從樣本建議 END_FRAC。
        if (samples.length === 0) return null
        const vh = window.innerHeight
        const avgTop = samples.reduce((sum, s) => sum + s.top, 0) / samples.length
        const suggestedEnd = avgTop / vh
        return { end: suggestedEnd, count: samples.length, avgTop }
      }

      function render() {
        samplesEl.innerHTML = ''
        samples.forEach((s, idx) => {
          const li = document.createElement('li')
          li.innerHTML = `<span>${s.name} · top=${s.top.toFixed(0)}px</span><button data-idx="${idx}">移除</button>`
          samplesEl.appendChild(li)
        })
        samplesEl.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            samples.splice(Number(btn.dataset.idx), 1)
            render()
          })
        })

        const fit = linearFit()
        if (!fit) {
          suggestEl.textContent = '尚無樣本——點地圖節點開始記錄。'
          outputEl.value = ''
          return
        }
        suggestEl.innerHTML = `依 ${fit.count} 筆樣本，建議 <strong>END_FRAC ≈ ${fit.end.toFixed(3)}</strong>（平均 top ${fit.avgTop.toFixed(0)}px ÷ 目前視窗高 ${window.innerHeight}px）。START_FRAC 目前為 <strong>${startFrac.toFixed(2)}</strong>（沿用滑桿上的值，抵達點無法反推它，只影響動作開始得多早）。`
        outputEl.value =
          `START_FRAC = ${startFrac.toFixed(2)}
END_FRAC   = ${fit.end.toFixed(3)}

// 對應 stopProgress() 裡：
const start = vh * ${startFrac.toFixed(2)};
const end   = vh * ${fit.end.toFixed(3)};

// 樣本明細：
${samples.map((s) => `${s.name}: top=${s.top.toFixed(0)}px`).join('\n')}`
      }

      const onCopyClick = () => {
        outputEl.select()
        document.execCommand('copy')
        const orig = copyBtn.textContent
        copyBtn.textContent = '已複製 ✓'
        setTimeout(() => { copyBtn.textContent = orig }, 1200)
      }
      copyBtn.addEventListener('click', onCopyClick)

      const onClearClick = () => { samples = []; render() }
      clearBtn.addEventListener('click', onClearClick)

      cleanupCalib = () => {
        startRange.removeEventListener('input', onStartRangeInput)
        endRange.removeEventListener('input', onEndRangeInput)
        startNum.removeEventListener('change', onStartNumChange)
        endNum.removeEventListener('change', onEndNumChange)
        toggle.removeEventListener('click', onToggleClick)
        mapNodesEl.removeEventListener('click', onNodesClick)
        copyBtn.removeEventListener('click', onCopyClick)
        clearBtn.removeEventListener('click', onClearClick)
      }
    }

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      startBtn.removeEventListener('click', onStartClick)
      textIO.disconnect()
      cleanupCalib?.()
      // React StrictMode/HMR 重新掛載時，清掉這次 effect 動態產生的 DOM
      // (map nodes、stop 卡片、progress dots)，避免下次掛載時重複 append。
      nodesGroup.innerHTML = ''
      stopsCol.innerHTML = ''
      rail.innerHTML = ''
    }
  }, [])

  return (
    <div className="kyoto-bloom" ref={rootRef} data-theme={theme ?? undefined}>
      {/* 品牌標記——固定在左上角,不隨頁面捲動,跟日夜間切換鈕對稱(見下方
          .theme-toggle)。用純文字「Tripace」而非圖示,對齊全站既有慣例
          (LandingPage.tsx/LegalPage.tsx/NotFoundPage.tsx 的 .landing-logo
          都是純文字標記,不是 favicon.svg 那個圖示)——這個元件是獨立
          scope 的 .kyoto-bloom,不共用 landing.css,故在 KyotoExploreBloom.css
          裡另外定義一份視覺上一致的樣式。點擊回首頁("/"),讓這個 demo
          頁面有明確的品牌歸屬/離開入口。 */}
      <a className="brand-mark" href="/">Tripace</a>
      {/* 日夜間切換——固定在右上角,不隨頁面捲動。theme 為 null(預設)時
          跟隨系統的 prefers-color-scheme,按下後切成明確的 dark/light,
          之後每次按下在兩者之間互切(不會回到「跟隨系統」,同大多數網站
          手動切換慣例一致)。圖示依「按下後會變成的樣子」顯示(currently
          light 時顯示月亮,代表按下去會變暗;反之顯示太陽),是動作提示
          而非目前狀態指示。 */}
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setTheme((t) => (isCurrentlyDark(t) ? 'light' : 'dark'))}
        title={isCurrentlyDark(theme) ? '切換成日間模式' : '切換成夜間模式'}
        aria-label={isCurrentlyDark(theme) ? '切換成日間模式' : '切換成夜間模式'}
      >
        {isCurrentlyDark(theme) ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
      </button>
      <section className="hero">
        <svg className="hero-ridge" viewBox="0 0 1200 300" preserveAspectRatio="none">
          <path
            d="M0,300 L0,220 Q120,140 260,190 T520,150 Q620,110 720,170 T980,140 Q1080,120 1200,180 L1200,300 Z"
            fill="none" stroke="currentColor" strokeWidth="1" opacity="0.18" style={{ color: 'var(--moss)' }}
          />
          <path
            d="M0,300 L0,250 Q160,190 320,230 T620,200 Q740,170 860,220 T1200,210 L1200,300 Z"
            fill="currentColor" opacity="0.06" style={{ color: 'var(--ink)' }}
          />
        </svg>

        <div className="hero-eyebrow">Kyoto · Higashiyama</div>
        <h1 className="hero-title">走進一個地方，<br /><em>而不只是到過。</em></h1>
        <p className="hero-sub">從地景、歷史、人文到日常生活，探索城市與自然之間那些容易錯過的故事。</p>
        <button className="hero-cta" id="startBtn" type="button">
          開始探索
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v9M4.5 9L8 12.5 11.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <div className="hero-scroll-hint"><span>SCROLL</span><span className="bar" /></div>
      </section>

      <div className="explore-intro" id="explore">
        <div className="explore-eyebrow">一條有因果關聯的路線</div>
        <h2 className="explore-title">東山的地形，決定了這一切</h2>
        <p className="explore-desc">地圖會留在左邊，跟著你往下走；每到一個地方，先讀一段介紹，再往下滑，看看那裡真正的樣子。</p>
      </div>

      <div className="progress-rail" id="progressRail" />

      <div className="journey">
        <div className="map-col">
          <div className="map-stage">
            <div className="map-window">
              <svg viewBox="0 -230 220 1130" preserveAspectRatio="xMidYMid meet" id="mapSvg">
                <path className="map-path-ghost" d="M110,-210 C158.51,-122.62 113.02,-143.09 104.33,-43.52 C95.73,55.01 118.88,21.46 122.68,120.29 C126.07,208.37 178.24,208.98 111.7,266.78 C48.59,321.59 70.82,336.2 116.8,406 C168.63,484.68 125.17,473.94 87.39,560.25 C48.02,650.19 114.1,620.35 142.35,714.38 C171.48,811.35 77.98,783.95 110,880" />
                <path className="map-path-fill" id="mapFill" d="M110,-210 C158.51,-122.62 113.02,-143.09 104.33,-43.52 C95.73,55.01 118.88,21.46 122.68,120.29 C126.07,208.37 178.24,208.98 111.7,266.78 C48.59,321.59 70.82,336.2 116.8,406 C168.63,484.68 125.17,473.94 87.39,560.25 C48.02,650.19 114.1,620.35 142.35,714.38 C171.48,811.35 77.98,783.95 110,880" />
                <circle className="map-cursor" id="mapCursor" r="4" cx="110" cy="-43.52" />
                <g id="mapNodes" />
              </svg>
            </div>
            <div className="map-caption" id="mapCaption">尚未出發</div>
          </div>
        </div>

        <div className="stops-col" id="stopsCol" />
      </div>

      {/* 單一共用的浮動照片圖層——位置/大小每一幀由 JS 直接設 inline style,
          從對應的 node 位置成長,再縮回同一個錨點。 */}
      <div className="bloom-photo" id="bloomPhoto">
        <img id="bloomImg" alt="" />
      </div>

      <section className="closing">
        <h2 className="closing-title">這條路線，只是一個開始</h2>
        <p className="closing-desc">每一個地方都有自己的地景、歷史與生活脈絡。探索，就是把這些點連成一條屬於你的路。</p>
        <a className="hero-cta" href="#">規劃我的探索路線</a>
      </section>

      {/* footer——參照 LandingPage.tsx 的 .landing-footer 結構,對齊全站
          既有的頁尾慣例(品牌名、法律資訊列、信用背書連結)。這個元件是
          獨立 scope 的 .kyoto-bloom,不共用 landing.css,故在
          KyotoExploreBloom.css 裡另外定義一份視覺上一致的樣式
          (kyoto-footer 開頭的 class 前綴,避免跟既有的 explore、stop 開頭
          的 class 撞名)。隱私權政策/服務條款連結沿用同一組既有頁面
          (/privacy、/terms),「聯絡我們」跟 LandingPage.tsx 一樣先用
          佔位連結。 */}
      <footer className="kyoto-footer">
        <span className="kyoto-footer-brand">Tripace · 行程規劃</span>
        <div className="kyoto-footer-bar">
          <span className="kyoto-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="kyoto-footer-links">
            <a href="/privacy">隱私權政策</a>
            <a href="/terms">服務條款</a>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="kyoto-footer-poweredby"
          href="https://onagent.shuttle.tools"
          target="_blank"
          rel="noreferrer"
        >
          Powered by onagent
        </a>
      </footer>

      {/* ============================================================
          校準面板——開發用工具，非正式頁面內容。只在 dev build 渲染，
          正式環境完全不會出現在 DOM 裡。開啟後捲到某個 node「感覺剛好
          抵達」的位置，點地圖上對應的節點，記錄目前捲動位置為一筆樣本。
          累積幾筆不同 stop 的樣本後，會用 stopProgress() 自己的公式
          (progress = (start - top) / (start - end))反推出能讓
          progress=1 剛好落在每筆記錄點的 START_FRAC/END_FRAC 建議值。
          ============================================================ */}
      {import.meta.env.DEV && (
        <>
          <button className="calib-toggle" id="calibToggle" type="button">⚙ 校準模式</button>
          <div className="calib-panel" id="calibPanel">
            <h4>路徑節奏校準</h4>
            <div className="calib-row">
              <label>start</label>
              <input type="range" id="startRange" min="0.3" max="1.2" step="0.01" defaultValue="0.95" />
              <input type="number" id="startNum" min="0.3" max="1.2" step="0.01" defaultValue="0.95" />
            </div>
            <div className="calib-row">
              <label>end</label>
              <input type="range" id="endRange" min="-0.3" max="0.6" step="0.01" defaultValue="0.10" />
              <input type="number" id="endNum" min="-0.3" max="0.6" step="0.01" defaultValue="0.10" />
            </div>
            <div className="calib-hint">
              校準模式開啟時，滑到你覺得「這個點應該剛好抵達」的位置，直接點地圖上對應的節點——每點一次記一筆樣本。上面兩條滑桿可以即時試調，頁面會馬上用新數字重算。
            </div>
            <ul className="calib-samples" id="calibSamples" />
            <div className="calib-suggest" id="calibSuggest">尚無樣本——點地圖節點開始記錄。</div>
            <textarea className="calib-output" id="calibOutput" rows={4} readOnly />
            <button className="calib-copy" id="calibCopy" type="button">複製輸出</button>
            <button className="calib-clear" id="calibClear" type="button">清空樣本</button>
          </div>
        </>
      )}
    </div>
  )
}
