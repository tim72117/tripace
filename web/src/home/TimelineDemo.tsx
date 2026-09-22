import { useEffect, useState } from 'react';
import styles from './TimelineDemo.module.css';

// TimelineDemo:「時間軸排程」功能卡片內嵌的假地圖+時間軸示範,見
// ProductPage.tsx 掛載處的完整說明——演示「在地圖上選景點,依序排進
// 每天時間軸」這個產品概念本身,不是真實地圖或真實時間軸元件,也不接
// 任何資料庫/API。
//
// 地圖視覺(320×320px 容器、街道/河川示意背景 SVG、精選點圓點樣式)
// 直接沿用 ThemePointDemo.tsx 已經做好的那一套——2026-09 使用者做完
// 「主題景點」卡片的示意地圖後,明確要求這裡的地圖比照辦理(「地圖可以
// 用主題景點的」),故街道/河川路徑座標、.demoDot 系列配色都是同一份
// 數值(見 ThemePointDemo.module.css 對應規則的完整說明,這裡不重複
// 展開理由,只搬過來用),不是重新設計一套地圖視覺。
//
// 2026-09:時間軸卡原本是跟地圖左右並排的獨立區塊,使用者接著要求
// 「時間軸放在地圖中」——改成用 position: absolute 疊在 .demoMapWrap
// 右下角,做成一張半透明浮動面板(類似真實地圖 App 上「搜尋結果清單/
// 行程摘要」蓋在地圖上方的常見版面模式),而非地圖外部另一塊區域。
// 地圖容器因此恢復成跟 ThemePointDemo 一致的 320×320px 滿版尺寸(不用
// 再為了並排而縮小成 240px),時間軸卡浮貼在地圖右下角,不佔用地圖外的
// 版面空間。
//
// 跟 ThemePointDemo 用同一份 POI_LIST 資料(赤崁樓周邊 6 個精選點的
// 名稱/類別/座標)——同一個示範情境的地圖延伸到這裡,使用者在同一張
// 卡片(功能介紹頁)脈絡下看到兩次「赤崁樓周邊」不會覺得突兀,反而更像
// 同一套資料在不同功能裡被使用,呼應真實產品「候選籃裡的景點可以拿去
// 排時間軸」的資料流動關係。
const POI_LIST = [
  { id: 'wude', name: '祀典武廟', x: 100, y: 118, category: 'street' as const },
  { id: 'mazu', name: '祀典大天后宮', x: 90, y: 180, category: 'street' as const },
  { id: 'quanmei', name: '全美戲院', x: 122, y: 232, category: 'craft' as const },
  { id: 'jinde', name: '金得春捲', x: 200, y: 226, category: 'restaurant' as const },
  { id: 'hayashi', name: '林百貨', x: 232, y: 160, category: 'street' as const },
  { id: 'fusheng', name: '富盛號碗粿', x: 212, y: 100, category: 'restaurant' as const },
] as const;

// SELECTED_IDS:示範只挑 3 個點依序排進時間軸(不是全部 6 個)——時間軸
// 卡的可視高度有限,塞 6 筆會太擠;3 筆足夠表達「排入時間軸」這個概念,
// 也留白讓畫面不會太滿。依 POI_LIST 裡由北到南、由早到晚的動線順序挑選
// (武廟→戲院→碗粿,大致沿路線走),讓時間軸上的順序跟地圖上的空間分布
// 有合理對應關係,不是隨機挑三個。
const SELECTED_IDS = ['wude', 'quanmei', 'fusheng'] as const;
const SELECTED_POIS = SELECTED_IDS.map((id) => POI_LIST.find((p) => p.id === id)!);

const TIME_SLOTS = ['09:30', '11:00', '13:30'] as const;

// 整個循環拆成五段,對應「點選景點→出現在時間軸」的完整體驗節奏(比照
// ThemePointDemo.tsx 的 Phase 狀態機設計慣例——用具名階段而非一堆各自
// 獨立的布林值,因為這幾個階段是嚴格先後順序、互斥的,字串聯合型別比
// 布林值排列組合更準確地限制住合法狀態):
//   idle      地圖顯示全部候選點,時間軸卡是空的——模擬「使用者還沒開始
//             選」的起始畫面。
//   selecting 3 個候選點依序被按下(逐一觸發按壓動畫,而非一起按下)——
//             跟 ThemePointDemo「一起浮現」的設計不同,這裡刻意逐一觸發
//             是因為「選景點」本來就是一個一個選的動作,跟「主題點一次
//             揭露全部精選點」是不同語意的互動,不套用同一種節奏。
//   flying    被選中的點依序飛入時間軸對應時段(從地圖座標飛向時間軸卡
//             位置的位移動畫)。
//   settled   時間軸完整顯示 3 筆已排入的行程,停留一段時間讓使用者看清
//             楚最終結果。
//   idle(重置) 淡出時間軸內容、地圖候選點恢復未選狀態,重新開始循環。
type Phase = 'idle' | 'selecting' | 'flying' | 'settled'

// SELECT_STEP_MS:每個候選點依序被按下的間隔——比 ThemePointDemo 的
// 單次按壓動畫(0.4s)略短一點時間差,讓三個點的按下動作有明顯的先後感,
// 但整體不會拖太久。
const SELECT_STEP_MS = 380;
// FLY_STEP_MS:每個已選點依序從地圖飛入時間軸對應時段格的間隔——跟
// SELECT_STEP_MS 分開設定(而非共用同一個常數),因為「按下候選點」跟
// 「飛入時間軸格」是視覺上不同的兩種動作,各自的節奏感可以獨立調整,
// 未來想讓其中一種更快/更慢時不會互相牽動。
const FLY_STEP_MS = 420;
const IDLE_MS = 1200;
const SETTLED_MS = 2400;

export function TimelineDemo({ dark }: { dark: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  // selectedCount:selecting 階段目前已經按下的候選點數量(0~3),逐一
  // 遞增——這裡刻意跟 ThemePointDemo 的「單一布林值一起觸發」設計不同
  // (見上方 Phase 型別說明的理由),用累加計數才能表達「依序點選」的
  // 動畫效果。
  const [selectedCount, setSelectedCount] = useState(0);
  // flownCount:flying 階段目前已經飛進時間軸的候選點數量(0~3)——跟
  // selectedCount 是獨立的兩個計數器,分屬 selecting/flying 兩個不同
  // 階段各自的進度,不合併成同一個數字,避免「按下」跟「飛入」這兩種
  // 視覺意義不同的動作共用同一個狀態變數而混淆。
  const [flownCount, setFlownCount] = useState(0);

  useEffect(() => {
    if (phase === 'idle') {
      const t = setTimeout(() => setPhase('selecting'), IDLE_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'settled') {
      const t = setTimeout(() => {
        setPhase('idle')
        setSelectedCount(0)
        setFlownCount(0)
      }, SETTLED_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  // selecting 階段:每隔 SELECT_STEP_MS 讓下一個候選點被按下,全部按完後
  // 轉入 flying 階段——用 selectedCount 本身當依賴,依目前進度決定下一步
  // (同 ThemePointDemo 的 PHASE_DELAYS 遞迴排程手法,而非固定 setInterval,
  // 理由同樣是不同階段/步驟間隔可能不等長,這裡雖然目前三步都等長,但
  // 用同一種手法保留未來調整彈性、也跟既有元件寫法一致)。
  useEffect(() => {
    if (phase !== 'selecting') return
    if (selectedCount >= SELECTED_POIS.length) {
      const t = setTimeout(() => setPhase('flying'), SELECT_STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setSelectedCount((c) => c + 1), SELECT_STEP_MS)
    return () => clearTimeout(t)
  }, [phase, selectedCount])

  // flying 階段:每隔 FLY_STEP_MS 讓下一個已選點飛入時間軸對應時段格,
  // 全部飛完後轉入 settled 階段——寫法同上面 selecting 階段的遞迴排程。
  useEffect(() => {
    if (phase !== 'flying') return
    if (flownCount >= SELECTED_POIS.length) {
      const t = setTimeout(() => setPhase('settled'), FLY_STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setFlownCount((c) => c + 1), FLY_STEP_MS)
    return () => clearTimeout(t)
  }, [phase, flownCount])

  const flying = phase === 'flying' || phase === 'settled'
  const settled = phase === 'settled'

  return (
    <div className={`${styles.demo} app-theme-root`} data-theme={dark ? 'dark' : 'light'}>
      {/* 假地圖——街道/河川示意背景+候選點,視覺規格(320×320px 容器、
          SVG 路徑座標、.demoDot 分類配色)整份沿用 ThemePointDemo.tsx/
          ThemePointDemo.module.css(見上方檔頭說明)。時間軸卡改成疊在
          這個容器內部右下角的浮動面板(見下方 .timeline 的完整說明),
          故這裡本身不再需要額外的並排 wrapper。 */}
      <div className={styles.demoMapWrap}>
          <svg className={styles.demoTerrain} viewBox="0 0 320 320" aria-hidden="true">
            <path className={styles.demoStreet} d="M -10 60 L 90 55 L 140 90 L 230 75 L 330 95" />
            <path className={styles.demoStreet} d="M 20 -10 L 35 80 L 25 180 L 60 330" />
            <path className={styles.demoStreet} d="M -10 220 L 100 210 L 180 250 L 330 240" />
            <path className={styles.demoStreet} d="M 250 -10 L 245 120 L 280 220 L 260 330" />
            <path className={styles.demoLane} d="M 65 55 L 70 140 L 40 190" />
            <path className={styles.demoLane} d="M 160 90 L 155 160 L 190 210" />
            <path className={styles.demoLane} d="M 245 120 L 190 130 L 165 170" />
            <path className={styles.demoLane} d="M 60 220 L 110 260 L 100 330" />
            <path className={styles.demoLane} d="M 180 250 L 220 280 L 260 260" />
            <path className={styles.demoLane} d="M 280 60 L 310 130 L 300 190" />
            <path className={styles.demoLane} d="M 100 40 L 130 55 L 120 100" />
            <path className={styles.demoLane} d="M 10 130 L 55 140 L 45 200" />
            <path className={styles.demoLane} d="M 140 200 L 170 230 L 150 280" />
            <path className={styles.demoLane} d="M 235 5 L 235 70 M 260 0 L 260 70 M 285 0 L 285 70 M 310 5 L 310 70" />
            <path className={styles.demoLane} d="M 232 15 L 320 15 M 232 35 L 320 35 M 232 55 L 320 55" />
            <path className={styles.demoRiver} d="M -10 280 C 60 260, 120 300, 180 270 S 300 220, 330 190" />
            <path className={styles.demoWater} d="M -10 -10 L 60 -10 C 75 10, 70 35, 50 45 C 25 55, -10 40, -10 20 Z" />
          </svg>

          {POI_LIST.map((poi) => {
            const categoryClass = styles[`demoDot${poi.category[0].toUpperCase()}${poi.category.slice(1)}`]
            const selectedIndex = SELECTED_IDS.indexOf(poi.id as typeof SELECTED_IDS[number])
            // isPicked:這個候選點是否已經在 selecting 階段被按下——用
            // selectedIndex(-1 表示不在 SELECTED_IDS 名單裡)跟
            // selectedCount 比較,而非另開一個 state 陣列記錄「哪些點被
            // 選了」,因為 SELECTED_IDS 本身順序固定,selectedCount 這個
            // 單一數字就足以推導出「前 selectedCount 個已選點」是誰。
            const isPicked = selectedIndex !== -1 && selectedIndex < selectedCount
            // isFlown:這個點是否已經飛進時間軸——跟 isPicked 一樣用索引
            // 比較 flownCount 逐一判斷,讓地圖上的點跟時間軸格是同步一個
            // 一個對應。2026-09:使用者要求「加進時間軸後不要消失,更改
            // 圖標就好」——點本身留在地圖原地(不再套用讓它淡出的
            // .demoPoiFlown transform/opacity),改成套用 .demoDotFlown
            // 只改圓點圖示本身的外觀(見 TimelineDemo.module.css 的完整
            // 說明),標記「這個點已經排進時間軸了」,而非讓整個節點消失。
            const isFlown = flying && selectedIndex !== -1 && (settled || selectedIndex < flownCount)
            return (
              <div
                key={poi.id}
                className={`${styles.demoPoi} ${isPicked ? styles.demoPoiPicked : ''}`}
                style={{ left: poi.x, top: poi.y }}
              >
                <div className={`${styles.demoDot} ${categoryClass} ${isFlown ? styles.demoDotFlown : ''}`} />
                <span className={styles.demoLabel}>{poi.name}</span>
              </div>
            )
          })}

          {/* 時間軸卡——全新 UI(地圖上沒有這個東西,見上方檔頭說明),用
              直式時段列表模擬正式產品 MultiTrackTimeline 的「每天時段排
              景點」概念(見 DesktopLayout.tsx 的 MultiTrackTimeline 掛載
              處),但大幅簡化成純展示用的靜態時段條,不是真的時間刻度尺
              或可拖曳元件。2026-09:使用者要求「時間軸放在地圖中」——
              改成 position: absolute 疊在 .demoMapWrap 右下角的半透明
              浮動面板(見 TimelineDemo.module.css 的 .timeline 完整
              說明),不是地圖外部另一塊並排區域。每個時段列預先畫出
              空白佔位(虛線框),被選中的景點依序「飛入」對應時段列時
              才填滿內容——用 CSS class 切換(.timelineCardFilled)搭配
              transition 做淡入,而非條件渲染,理由同 ThemePointDemo 的
              .demoPoiRevealed 完整說明(節點需要一直存在,瀏覽器才有
              「上一個狀態」可以過渡)。 */}
          <div className={styles.timeline}>
            <div className={styles.timelineHeader}>今日時間軸</div>
            {TIME_SLOTS.map((time, index) => {
              const poi = SELECTED_POIS[index]
              // filled:這個時段格是否已經填入景點——用 index 跟
              // flownCount 比較(同地圖 isFlown 的判斷邏輯),讓時段格
              // 依序一個個填入,跟地圖上對應的點同步「飛走/落地」,而非
              // 一次全部出現。
              const filled = settled || (phase === 'flying' && index < flownCount)
              return (
                <div key={time} className={styles.timelineSlot}>
                  <span className={styles.timelineTime}>{time}</span>
                  <div className={`${styles.timelineCard} ${filled ? styles.timelineCardFilled : ''}`}>
                    {filled && <span className={styles.timelineCardLabel}>{poi.name}</span>}
                  </div>
                </div>
              )
            })}
          </div>
      </div>
    </div>
  );
}
