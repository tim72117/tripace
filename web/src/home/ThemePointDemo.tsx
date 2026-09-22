import { useEffect, useState } from 'react';
import styles from './ThemePointDemo.module.css';

// ThemePointDemo:「主題景點」功能卡片內嵌的假地圖示範,見 ProductPage.tsx
// 掛載處的完整說明——演示「主題點揭露周邊精選點」這個產品概念本身,
// 不是真實 Google Maps,也不接任何資料庫/API。
//
// 2026-09:純靜態展示,不含任何互動——原本試過加一顆「移除精選點」的
// 按鈕讓使用者實際點一次感受效果,但使用者明確要求拿掉這個互動,只保留
// 地圖示意圖本身,單純呈現「主題點+精選點」這個空間關係的靜態畫面。
//
// 2026-09:改成直接嵌在「主題景點」功能卡片(.product-feature-card)
// 內部,不再是卡片格線之後另一個獨立區塊——原本這裡自己畫了一份
// h3「主題點怎麼運作？」+ p 說明文字,搭配獨立的卡片外觀(背景/邊框/
// 圓角/陰影,見 ThemePointDemo.module.css 先前版本的 .demo 規則),
// 現在改成純粹只輸出地圖示意圖本身——標題/說明文字交給
// .product-feature-card 自己的 h3/p(FEATURES 陣列裡「主題景點」那筆
// 資料的 title/description),不重複渲染第二份;外層卡片外觀也拿掉,
// 避免變成「卡片裡面又包一層卡片」的視覺巢狀。
//
// 樣式直接沿用正式地圖上主題點/精選點的真實視覺規格(geoAttractionOverlay.ts
// renderContent() 產生的 DOM 結構、ExploreMap.module.css 的
// .geo-attraction-glow/-landmark-photo/-landmark-placeholder/
// -curated-dot/-label)——使用者明確要求「要跟實際的樣式一樣」,故用
// 同樣的 DOM 結構(div 光暈+img/placeholder 圓+label 標籤),搭配真實
// CSS Module(ThemePointDemo.module.css 直接照抄 ExploreMap.module.css
// 對應規則的數值,理由見該檔案開頭說明)。座標系是像素絕對定位(容器
// 320×320px),因為真實地圖上的地標本來就是像素座標(投影後的螢幕座標),
// 不是抽象比例座標,改用像素定位更貼近真實情境的視覺尺度感(56px 圓在
// 320px 容器裡的相對大小,才是使用者實際在地圖上會看到的比例)。
//
// 掛 app-theme-root class(對齊 InteractiveExploreMap.tsx 的既有模式)
// 是因為 base-ui.css 的 --ios-sand/--ios-card/--color-dark 等 token 只在
// 這個 class scope 下才有定義——ProductPage.tsx 本身是完全不同的
// .product-page scope(京都紙感和風配色),不會自動繼承這些 token,若不
// 明確掛上就會拿到 undefined 的 CSS 變數,退回瀏覽器預設值(通常是黑色
// 或透明),顏色會整個跑掉。
//
// 2026-09:dark prop——base-ui.css 的深色模式規則(見該檔案開頭「四段式
// 寫法」的完整說明)只有在 .app-theme-root 元素本身帶有明確的
// data-theme="dark"/"light" 屬性時,才會切到「使用者手動選定」的那個
// 分支;沒有這個屬性時,.app-theme-root 只會跟隨瀏覽器的
// prefers-color-scheme 系統設定,不會理會 ProductPage.tsx 自己那顆
// 日夜間切換鈕的 theme state——這正是使用者實測回報「切換鈕按了,但
// 地圖示意圖沒有跟著變色」的根因:只掛了 class、沒有掛對應的
// data-theme 屬性。ProductPage.tsx 把自己已經算好的 dark(布林值,見
// isCurrentlyDark)往下傳,這裡轉換成 data-theme="dark"|"light" 字串
// 設在同一個 .app-theme-root 元素上,兩個 scope(.product-page 跟
// .app-theme-root)的深色模式狀態才會真正同步,而非各自獨立判斷。
const THEME_POINT_LABEL = '赤崁樓';
// THEME_POINT_PHOTO:荷式城堡建築示意圖(Serena Koi / Pexels)——跟
// docs/research-tainan-chikan-craft-theme-2026-09.md 研究試做時找的同一張
// 圖,語意呼應赤崁樓「荷蘭城堡地基」意象,非赤崁樓實景。
const THEME_POINT_PHOTO = 'https://images.pexels.com/photos/12476799/pexels-photo-12476799.jpeg?cs=srgb&fm=jpg&w=200';

// POI_LIST 座標是容器 320×320px 座標系裡手動排列出來的相對位置(不是
// 真實經緯度換算),刻意排成疏密不均的自然分布(不排成正圓形,避免看起來
// 太工整、不像真實地圖上店家分布的隨機感)。
const POI_LIST = [
  { id: 'wude', name: '祀典武廟', x: 100, y: 118, category: 'street' as const },
  { id: 'mazu', name: '祀典大天后宮', x: 90, y: 180, category: 'street' as const },
  { id: 'quanmei', name: '全美戲院', x: 122, y: 232, category: 'craft' as const },
  { id: 'jinde', name: '金得春捲', x: 200, y: 226, category: 'restaurant' as const },
  { id: 'hayashi', name: '林百貨', x: 232, y: 160, category: 'street' as const },
  { id: 'fusheng', name: '富盛號碗粿', x: 212, y: 100, category: 'restaurant' as const },
] as const;

const THEME_POINT = { x: 160, y: 160 };

// 整個循環拆成四段時間,模擬「點下主題點→系統加載→結果出現→看完
// 收回」的真實體驗節奏(使用者明確要求「點下後延遲一下才出現附近
// 點」,不要按壓動畫播完就立刻同時浮現精選點):
//   HIDDEN_MS  收合、只顯示主題點的時間——模擬「使用者還沒點開主題點」
//              的畫面,停留夠久讓人看清楚這是收合狀態。
//   PRESS_MS   主題點按下瞬間到按壓動畫播完的時間——對齊
//              .demoPhotoPressed 的 animation-duration(0.4s,見
//              ThemePointDemo.module.css 的完整說明),兩處數字刻意
//              保持一致,這裡結束的瞬間正好是按壓動畫播完的瞬間。
//   LOAD_DELAY_MS 按壓動畫播完後,精選點浮現前的額外停頓——模擬「按下
//              去之後系統要花一點時間才把結果load出來」的體感延遲,
//              不是技術上真的有任何非同步請求,單純是刻意留白的動畫
//              節奏設計。
//   HOLD_MS    精選點全部一起浮現後,維持完整畫面停留的時間——給使用者
//              足夠時間看清楚「主題點+全部精選點」的完整關係,再收回
//              重播。
const HIDDEN_MS = 1400;
const PRESS_MS = 400;
const LOAD_DELAY_MS = 400;
const HOLD_MS = 2200;

// Phase:循環的四個階段,對應上面四段時間——用具名階段而非兩個獨立
// 布林值(例如 pressed/revealed 各自 true/false),是因為「按下」跟
// 「浮現」不是兩個各自獨立切換的開關,而是同一個循環裡有嚴格先後順序
// 的四個互斥狀態,用一個 enum 般的字串聯合型別表達,比兩個布林值的
// 排列組合(其中有些組合在邏輯上不該發生,例如「還沒按下但已經浮現」)
// 更準確地限制住合法狀態,也讓 useEffect 裡的狀態機讀起來更直接對應
// 這四個階段各自要等多久、下一步要切到哪個階段。
type Phase = 'hidden' | 'pressed' | 'revealed'

const PHASE_DELAYS: Record<Phase, number> = {
  hidden: HIDDEN_MS,
  pressed: PRESS_MS + LOAD_DELAY_MS,
  revealed: HOLD_MS,
}

const NEXT_PHASE: Record<Phase, Phase> = {
  hidden: 'pressed',
  pressed: 'revealed',
  revealed: 'hidden',
}

export function ThemePointDemo({ dark }: { dark: boolean }) {
  // phase:目前循環走到哪一階段(見上方 Phase 型別/PHASE_DELAYS/
  // NEXT_PHASE 的完整說明)——'hidden' 時主題點按壓動畫與精選點都不
  // 觸發;'pressed' 時主題點播放按壓動畫、精選點仍隱藏(這正是使用者
  // 要求的「點下後延遲一下才出現附近點」那段延遲);'revealed' 時
  // 精選點才一起浮現。
  //
  // 使用者要求「做出點選主題點出現附近景點的輪播動畫」——這裡刻意選擇
  // 自動播放(頁面載入後就開始循環展示)而非真的要使用者點擊主題點才
  // 觸發,理由是這個元件先前已經明確拿掉過一次互動式操作(移除精選點
  // 的按鈕,見上方「純靜態展示」段落的完整說明),這次沿用同一個「純
  // 展示用途、不需要使用者操作」的定位,用自動輪播模擬這個互動情境
  // 給人的視覺印象,而非真的重新加一個可點擊的主題點。
  const [phase, setPhase] = useState<Phase>('hidden');

  useEffect(() => {
    const timeoutId = setTimeout(() => setPhase(NEXT_PHASE[phase]), PHASE_DELAYS[phase])
    return () => clearTimeout(timeoutId)
  }, [phase])

  const pressed = phase === 'pressed' || phase === 'revealed'
  const revealed = phase === 'revealed'

  return (
    <div className={`${styles.demo} app-theme-root`} data-theme={dark ? 'dark' : 'light'}>
      {/* 假地圖本體——320×320px 的絕對定位容器,不是真實地圖投影,純粹
          用來排列主題點/精選點的相對位置。2026-09:使用者回報「太多
          線條、不要外匡」,拿掉了原本的棋盤格線背景與主題點→精選點
          連線(理由見 ThemePointDemo.module.css 對應規則移除處的完整
          說明)——但拿掉之後背景變得太空,使用者接著要求「做一些假的
          街道河川示意」,改用低對比度的抽象街道/河川線條當背景質感,
          取代原本規則的棋盤格線。這裡的路徑座標是手動畫出來的示意
          線條(不規則折線模擬街道、一條較粗的弧線模擬河川),不對應
          任何真實地理資料,純粹營造「這是一張地圖」的視覺聯想——顏色
          刻意用很淡的 --line token(見下方 .demoStreets/.demoRiver 的
          說明),避免搶過主題點/精選點本身的視覺焦點。 */}
      <div className={styles.demoMapWrap}>
        <svg className={styles.demoTerrain} viewBox="0 0 320 320" aria-hidden="true">
          {/* 街道(主幹道)——幾條橫跨整個畫面的不規則折線,模擬地圖底圖
              上常見的街廓紋理,刻意不平行/不等距,避免看起來像人工棋盤
              格線。 */}
          <path className={styles.demoStreet} d="M -10 60 L 90 55 L 140 90 L 230 75 L 330 95" />
          <path className={styles.demoStreet} d="M 20 -10 L 35 80 L 25 180 L 60 330" />
          <path className={styles.demoStreet} d="M -10 220 L 100 210 L 180 250 L 330 240" />
          <path className={styles.demoStreet} d="M 250 -10 L 245 120 L 280 220 L 260 330" />
          {/* 巷弄(次要街道)——比主幹道短、不貫穿整個畫面,長度/角度不一,
              暗示這些是連接主幹道之間的小巷,而非另一批主要道路。用
              styles.demoLane(比 demoStreet 更細更淡)區隔份量層級,避免
              加了更多線條後畫面又變得跟拿掉的棋盤格線一樣搶眼。 */}
          <path className={styles.demoLane} d="M 65 55 L 70 140 L 40 190" />
          <path className={styles.demoLane} d="M 160 90 L 155 160 L 190 210" />
          <path className={styles.demoLane} d="M 245 120 L 190 130 L 165 170" />
          <path className={styles.demoLane} d="M 60 220 L 110 260 L 100 330" />
          <path className={styles.demoLane} d="M 180 250 L 220 280 L 260 260" />
          <path className={styles.demoLane} d="M 280 60 L 310 130 L 300 190" />
          {/* 2026-09:使用者貼了一張真實 Google Maps 深色底圖截圖當參考,
              密度遠高於這裡(截圖等級大概要 30-50 條線),但明確表示
              「不用做太細」——這裡只是再補幾條、加深一點點紋理感,不是
              照著截圖密度複製,維持示意用途的克制份量。 */}
          <path className={styles.demoLane} d="M 100 40 L 130 55 L 120 100" />
          <path className={styles.demoLane} d="M 10 130 L 55 140 L 45 200" />
          <path className={styles.demoLane} d="M 140 200 L 170 230 L 150 280" />
          {/* 街區網格——2026-09 使用者要求「有一點街區的格狀街道」,在
              畫面右上角(富盛號碗粿右側、目前線條較稀疏的一小塊區域)
              加一組規則方格網,模擬市區棋盤式規劃的街廓,跟其餘不規則
              主幹道/巷弄並存——不是整張圖都改成棋盤格(那樣會重蹈先前
              拿掉的棋盤格線問題),只在這一小塊範圍(約 85×70px)呈現
              「這一區剛好是規劃過的市區」的局部真實感,樣式沿用
              .demoLane(細、淡),份量跟其餘巷弄線條一致,不會特別搶眼。 */}
          <path className={styles.demoLane} d="M 235 5 L 235 70 M 260 0 L 260 70 M 285 0 L 285 70 M 310 5 L 310 70" />
          <path className={styles.demoLane} d="M 232 15 L 320 15 M 232 35 L 320 35 M 232 55 L 320 55" />
          {/* 河川——單一條較粗、帶自然弧度的曲線,顏色/線寬都跟街道區隔
              開來(更粗、更藍),斜向貫穿畫面暗示地圖邊緣的水系。 */}
          <path className={styles.demoRiver} d="M -10 280 C 60 260, 120 300, 180 270 S 300 220, 330 190" />
          {/* 水域——左上角一小塊不規則色塊,呼應使用者參考截圖裡左上角
              那塊深藍色水域,用填色(非線條)區塊表現,跟河川同色系但
              是封閉區域而非曲線。 */}
          <path className={styles.demoWater} d="M -10 -10 L 60 -10 C 75 10, 70 35, 50 45 C 25 55, -10 40, -10 20 Z" />
        </svg>

        {/* 精選點——結構對齊 geoAttractionOverlay.ts renderContent() 的
            精選點分支(未 hover 時只畫 .demoDot 圓點+標籤,不帶照片),
            配色沿用 ExploreMap.module.css 的 -tea/-restaurant/-craft/
            -street 四個分類 modifier(這裡用 styles[`demoDot${category}`]
            動態組 CSS Modules 的 class 名稱,因為分類是執行期字串,不能
            寫死成 JSX 裡的固定 className)。
            2026-09:全部精選點共用同一個 revealed 布林狀態,同一瞬間
            一起顯示/收合(使用者明確要求「不是一一出現,點下後要一起
            出現」,不是依序淡入)。全部 POI_LIST 節點一開始就都在 DOM
            裡(不是等浮現才掛載),靠 CSS class(.demoPoiRevealed)切換
            opacity/transform 做淡入動畫,而非用條件渲染讓節點真的
            出現/消失——條件渲染會讓每次浮現都是全新掛載的 DOM 節點,
            CSS transition 不會播放(瀏覽器沒有「上一個狀態」可以
            過渡),必須讓節點一直存在、只切換 class 才能讓淡入效果
            真正生效。 */}
        {POI_LIST.map((poi) => {
          const categoryClass = styles[`demoDot${poi.category[0].toUpperCase()}${poi.category.slice(1)}`]
          return (
            <div
              key={poi.id}
              className={`${styles.demoPoi} ${revealed ? styles.demoPoiRevealed : ''}`}
              style={{ left: poi.x, top: poi.y }}
            >
              <div className={`${styles.demoDot} ${categoryClass}`} />
              <span className={styles.demoLabel}>{poi.name}</span>
            </div>
          )
        })}

        {/* 主題點——結構對齊 geoAttractionOverlay.ts renderContent() 的
            主題點分支(光暈+圓形地標照片+標籤)。THEME_POINT_PHOTO 是
            Pexels 示意圖(非赤崁樓實景,理由同 JiufenPage.tsx/KyotoPage.tsx
            既有慣例:多數站點也是示意圖,見這兩個檔案開頭的完整說明)
            ——不直接從資料庫拉真實的 base64 照片(attractions.photo_url,
            見 lmk_f1e80f8e7fdf 這筆「赤崁樓」正式資料),那是一段很長的
            base64 data URI,硬寫進前端常數會讓這個檔案暴增到難以維護,
            而且這裡本來就是純示範用途,不需要接真正的資料庫內容。
            2026-09:使用者要求「按主題點時,加上按下的動畫」——.demoPhoto
            套上 styles.demoPhotoPressed(只在 pressed 為 true 時,見下方
            className 的條件判斷),用 CSS keyframes 播放一次「縮小→
            彈回」的按壓回饋(見 ThemePointDemo.module.css 的完整說明)。
            用 key={String(pressed)} 讓 React 在 pressed 從 false→true
            (以及 true→false)切換時,把這個 <img> 視為全新節點重新
            掛載——這是刻意的:CSS animation 只在「這個 class 第一次被
            套用」時觸發,若沒有 key,pressed 從 true 收回 false、下次
            又變 true 時,React 會判斷成同一個 DOM 節點只是 class 變了
            兩次,瀏覽器不會重播已經播完的 animation(跟 transition 不同,
            animation 沒有「回到起點再播」這件事,除非節點真的重新建立
            或動畫本身設計成雙態循環)。用 key 強制重新掛載,確保每次
            循環的「按下」瞬間都能重新播放一次按壓動畫。
            2026-09:使用者接著要求「點下後延遲一下才出現附近點」——按壓
            動畫的觸發時機(pressed)跟精選點浮現的時機(revealed)原本
            是同一個布林值同時觸發,現在拆成 phase 狀態機的兩個階段:
            'pressed' 階段先播放這裡的按壓動畫,精選點仍保持隱藏;等
            LOAD_DELAY_MS 過後才轉入 'revealed' 階段,精選點才一起浮現
            (見上方 Phase/PHASE_DELAYS 的完整說明),模擬「點下去→
            系統加載→結果出現」的真實體驗,而非按下去的瞬間就同時看到
            結果。 */}
        <div className={styles.demoTheme} style={{ left: THEME_POINT.x, top: THEME_POINT.y }}>
          <div className={styles.demoGlow} />
          <img
            key={String(pressed)}
            className={`${styles.demoPhoto} ${pressed ? styles.demoPhotoPressed : ''}`}
            src={THEME_POINT_PHOTO}
            alt={THEME_POINT_LABEL}
            loading="lazy"
          />
          <span className={styles.demoLabel}>{THEME_POINT_LABEL}</span>
        </div>
      </div>
    </div>
  );
}
