import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { List as ListIcon, Search as SearchIcon } from 'lucide-react';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import styles from './ScrollTimeline.module.css';
import type { AccentColorProp } from './accentColor';

// ScrollTimeline:「文案隨捲動、左側時間軸漸進顯示錨點、點縮圖向右展開
// 地圖」這整套互動機制的共用元件——改成 compound components 模式
// (<ScrollTimeline><ScrollTimeline.Anchor>...</ScrollTimeline.Anchor>...
// </ScrollTimeline>),取代原本 ScrollTimelineMap.tsx 那版「丟一包
// anchors[] 資料陣列,元件自己把文案渲染成固定 .stop 區塊清單」的資料
// 驅動寫法。
//
// 2026-10 使用者明確要求改用這個模式,原因是資料驅動版本把文案排版鎖死
// 成「一筆資料 = 一個區塊」,呼叫端無法在文案中間插錨點、無法自由排版
// (夾雜圖片/子標題/跨段落內容)。改成 compound components 後,呼叫端
// 自己寫文案 JSX,想怎麼排就怎麼排,只在想標記成「捲動錨點」的地方插入
// <ScrollTimeline.Anchor id="..." thumb="..." theme="...">——這個子
// 元件掛載時透過 Context 向外層 <ScrollTimeline> 註冊自己(id/thumb/
// theme/DOM 節點),卸載時反註冊,外層的時間軸/地圖面板完全不需要知道
// 文案長什麼樣,只透過 Context 知道「目前註冊了哪些錨點、依註冊順序
// 排第幾個、誰是目前捲動到的 active」。
//
// 代價(使用者已確認接受,見對話記錄):兩個子元件不是完全獨立、互不
// 相依的元件——<ScrollTimeline.Anchor> 離開 <ScrollTimeline> 的 Context
// 就無法運作(找不到 Provider 會直接 throw,見下方 useScrollTimelineContext
// 的說明),這是 compound components 模式本來就有的特性,不是這次改寫
// 的缺陷。
//
// 色票:中性色(--paper/--ink/--ink-soft/--line)沿用 CityPageFooter.
// module.css/ExploreOtherCities.module.css 的既有手法(見該二檔案開頭
// 說明)——不在這個元件內重新定義,直接讀呼叫端頁面作用域(各城市頁
// .xxx-page class)已經定義好的同名變數,這幾個顏色站內所有頁面共用
// 同一套命名,不會各自取不同名字,漏寫的機會很低,維持原本模式。
// 強調色改用必填的 accentColor prop(見 accentColor.ts 的完整說明)
// 而非讀 CSS 變數——這是跟中性色唯一不同的地方,因為強調色是每個
// 城市頁各自不同的值。

// AnchorMeta:Context 登記簿裡每個錨點存的中繼資料——id 是穩定識別碼
// (呼叫端自訂,註冊/反註冊/IntersectionObserver 比對整個靠它),thumb
// 是時間軸圓形縮圖網址,theme 是這個錨點對應地圖上哪個主題點的人類
// 可讀名稱(選填,未填時退回 <ScrollTimeline defaultOpenTheme>),label
// 是地圖開關按鈕 aria-label 用的簡短可讀文字(選填,未填退回 id 本身
// ——Anchor 的 children 是自由排版的 JSX,不保證抽得出一句話當文字
// 描述,故不強制要求)。
// center:2026-10 新增——這個錨點對應地圖要移動到的原始座標,不透過
// theme(主題點名稱比對)。使用者明確要求「地圖隨錨點移動中心點」,但
// theme 只能指向資料庫裡 isTheme=true 的主題點,無法指向一般精選點
// (例如祀典武廟/林百貨這類已建檔但非主題點的地標)或根本不在資料庫裡
// 的地點(例如神農街、天下南隅);center 讓呼叫端直接提供任意座標當
// 這個錨點的地圖中心,繞過主題點比對。theme 跟 center 可以並存於不同
// 錨點(同一頁面裡,指向真正主題點的錨點用 theme 以取得開卡/揭露附近
// 景點等完整效果;指向其他地點的錨點用 center 只單純移動視角),但同一
// 個錨點不建議兩者都填——同時填時 theme 優先(見
// InteractiveExploreMap.tsx 的完整說明),center 會被忽略。
interface AnchorMeta {
  id: string
  thumb: string
  theme?: string
  center?: { lat: number; lng: number }
  label?: string
}

// PanelMode:右側面板目前以哪種模式開著——'map' 是「地圖」按鈕,只把
// 小地圖中心移到該錨點對應的主題點、不彈出任何卡片;'nearby' 是「附近
// 景點」按鈕,除了移中心之外連帶顯示該主題點的「附近景點」清單(不顯示
// 完整介紹卡——照片/名稱/簡介,只露出清單本身,見 InteractiveExploreMap
// 的 themeCardNearbyOnly prop 說明)。
// 2026-10:這兩個模式曾一度被合併成單一按鈕(「附近景點」+放大鏡圖示),
// 使用者明確要求改回兩顆各自獨立的按鈕,保留分開的語意。
type PanelMode = 'map' | 'nearby'

// SHOW_NEARBY_LIST_BUTTON:2026-10 使用者要求先隱藏「附近景點」這顆按鈕
// (暫時收起來,不是刪除功能)——'nearby' 這個模式/openCardOnFocus/
// themeCardNearbyOnly 的完整機制都保留不動,只是 UI 上先不讓使用者點
// 得到,之後要重新顯示只需要把這個常數改回 true,不需要重寫任何邏輯。
// 關閉時 modeGroup 只剩「地圖」一段,高度跟著用 .nodeCurrentSolo 調整
// (見下方按鈕組渲染處跟 CSS module 的說明),避免按鈕組留下只有單一
// 段落卻還保留兩段高度的空白。
const SHOW_NEARBY_LIST_BUTTON = false

// PanelState:面板「開著」時的完整描述——id 是哪個錨點、mode 是哪種模式;
// null 表示關著。合成一個物件而非兩個獨立 state,是因為兩者永遠一起
// 變動(開/關/切錨點/切模式都要同時決定兩個值),拆開反而要在每個
// setter 呼叫處小心同步,也會出現「id 有值但 mode 是 null」這種不合法的
// 中間狀態。
interface PanelState {
  id: string
  mode: PanelMode
}

interface ScrollTimelineContextValue {
  register: (meta: AnchorMeta) => void
  unregister: (id: string) => void
  setNode: (id: string, el: HTMLElement | null) => void
  order: string[]
  active: number
  openAnchorId: string | null
  toggleAnchor: (id: string, mode?: PanelMode) => void
}

const ScrollTimelineContext = createContext<ScrollTimelineContextValue | null>(null);

function useScrollTimelineContext(componentName: string): ScrollTimelineContextValue {
  const ctx = useContext(ScrollTimelineContext);
  if (!ctx) {
    throw new Error(`<ScrollTimeline.${componentName}> 必須放在 <ScrollTimeline> 底下使用`);
  }
  return ctx;
}

export function ScrollTimeline({
  children,
  // city:嵌入的地圖面板要查詢的城市——直接透傳給 InteractiveExploreMap
  // 的 city prop(見該元件開頭說明),對應後端 publicAttractionsCityAllowlist
  // 白名單裡的其中一個值。
  city,
  // accentColor:必填——這個元件的強調色(時間軸圓點、地圖面板外框/
  // 陰影等多處用到,見 ScrollTimeline.module.css 裡所有
  // var(--timeline-accent) 的地方)。完整說明見 accentColor.ts。
  accentColor,
  // defaultOpenTheme:沒有在個別 <ScrollTimeline.Anchor theme="..."> 指定
  // 時的共用退回值——單一主題城市頁(例如九份只有「九份老街」一個主題
  // 點)不需要每個錨點都重複填同一個名稱。
  defaultOpenTheme,
  // mapRestrictRadiusKm:直接透傳給 InteractiveExploreMap 的
  // restrictRadiusKm prop(見該元件開頭完整說明)——未傳時退回該元件
  // 自己的預設值(4km)。2026-10 新增,讓套用這個元件的頁面(例如同城市
  // 有多個主題點、彼此距離較遠的 TainanChikanPage.tsx)可以視實際景點
  // 分布調整嵌入式小地圖的可拖曳範圍,不被固定寫死的全域預設值綁住。
  mapRestrictRadiusKm,
}: {
  children: ReactNode
  city: string
  accentColor: AccentColorProp
  defaultOpenTheme?: string
  mapRestrictRadiusKm?: number
}) {
  // order:已註冊錨點的 id,依註冊順序排列——React 對同層 children 的
  // mount effect 會依 JSX 書寫順序(文件順序)依序觸發,故只要呼叫端把
  // <ScrollTimeline.Anchor> 依想要的時間軸順序寫進文案裡,這裡 append
  // 出來的順序自然就是正確的時間軸順序,不需要呼叫端額外標註索引。
  const [order, setOrder] = useState<string[]>([]);
  const metaRef = useRef<Map<string, AnchorMeta>>(new Map());
  const nodeRef = useRef<Map<string, HTMLElement>>(new Map());
  const elementToIdRef = useRef<Map<Element, string>>(new Map());

  const register = useCallback((meta: AnchorMeta) => {
    metaRef.current.set(meta.id, meta);
    setOrder((prev) => (prev.includes(meta.id) ? prev : [...prev, meta.id]));
  }, []);

  const unregister = useCallback((id: string) => {
    metaRef.current.delete(id);
    const el = nodeRef.current.get(id);
    if (el) elementToIdRef.current.delete(el);
    nodeRef.current.delete(id);
    setOrder((prev) => prev.filter((x) => x !== id));
  }, []);

  const setNode = useCallback((id: string, el: HTMLElement | null) => {
    const prevEl = nodeRef.current.get(id);
    if (prevEl) elementToIdRef.current.delete(prevEl);
    if (el) {
      nodeRef.current.set(id, el);
      elementToIdRef.current.set(el, id);
    } else {
      nodeRef.current.delete(id);
    }
  }, []);

  // active:用 IntersectionObserver 觀察每個已註冊錨點的 DOM 節點,回傳
  // 目前「最接近螢幕中線」的錨點在 order 裡的索引。不用 scroll 事件手動
  // 算位置(需要自己節流、自己算 getBoundingClientRect,效能與準確度都
  // 不如原生 API),改用 rootMargin 把觀察視窗收窄成貫穿畫面垂直中線的
  // 一條窄帶——哪個錨點目前進入這條窄帶,就視為「目前捲動到的段落」。
  // order 變動(錨點掛載/卸載)時重新建立觀察者,確保永遠觀察著當下
  // 註冊的節點集合。
  const [active, setActive] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length === 0) return;
        const indices = intersecting
          .map((e) => {
            const id = elementToIdRef.current.get(e.target);
            return id ? order.indexOf(id) : -1;
          })
          .filter((i) => i >= 0);
        if (indices.length > 0) setActive(Math.max(...indices));
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );

    order.forEach((id) => {
      const el = nodeRef.current.get(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [order]);

  // panel:目前面板狀態(見 PanelState 說明;null 表示關著)——任一時刻
  // 最多只能有一個面板打開(點開另一個錨點時直接切換過去,不會同時疊出
  // 兩個面板),所以單一物件就足夠表達「目前是哪一個、以什麼模式」。
  //
  // toggleAnchor 的規則:
  // - 傳入的 mode 省略時(縮圖按鈕/上下點小圓點)沿用目前開著的模式,
  //   面板關著則預設 'map'——點縮圖只是「把面板叫出來/收起來」,不應
  //   偷偷改變使用者先前選的模式。
  // - 同一個錨點 + 同一個模式再按一次 → 關閉(對稱「地圖」/「附近景點」
  //   按鈕的 toggle 行為)。
  // - 同一個錨點但不同模式 → 只切換模式,面板不會先關再開(使用者看到的
  //   是卡片出現/消失,地圖中心不動)。
  // - 不同錨點 → 切過去,模式照傳入值(省略則沿用)。
  const [panel, setPanel] = useState<PanelState | null>(null);
  const openAnchorId = panel?.id ?? null;
  const toggleAnchor = useCallback((id: string, mode?: PanelMode) => {
    setPanel((prev) => {
      const nextMode = mode ?? prev?.mode ?? 'map';
      if (prev && prev.id === id && prev.mode === nextMode) return null;
      return { id, mode: nextMode };
    });
  }, []);

  // growReady:2026-10(第三版)——地圖面板的展開動畫改成「外框本身長
  // 寬」:.mapPanel 從時間軸欄位寬度的窄條(.mapPanelGrowStart)用 CSS
  // animation(.mapPanelGrowing,見 CSS module @keyframes mapPanelGrow)
  // 長到全寬,圓角/陰影/髮線環全部跟著外框一起移動;裡面的地圖+關閉鈕
  // 裝在絕對定位、寬度鎖在最終全寬(100cqw)的 .mapPanelBody 裡,外框
  // 長寬過程中內容尺寸完全不變,只是被外框的 overflow:hidden 逐步露出。
  //
  // 前一版是「外框瞬間以最終尺寸出現、只有內部疊的一層紙色遮罩
  // (.mapPanelReveal)用 clip-path 收合」,使用者回報「邊框一開始就打開,
  // 然後才出現一個縮合的效果,邊框都沒動」——外框跟內容是兩段不同步的
  // 動作,視覺上割裂。改成外框長寬後,整個面板(含邊界)就是同一個展開
  // 事件,也不再需要遮罩層。
  //
  // 為什麼仍然要一個 state 而不是純 CSS(.mapPanelOpen .mapPanel 直接掛
  // animation):.mapPanelWrap 從 visibility:hidden 切成可見跟 animation
  // 開始播放若落在同一個 frame,部分瀏覽器會直接跳到動畫終點(前一版
  // revealReady 的既有發現)。所以開啟的第一個 commit 先套
  // .mapPanelGrowStart(停在窄條起始狀態,不播動畫),下一個
  // requestAnimationFrame 再切成 .mapPanelGrowing 讓 animation 從頭播。
  //
  // 這個 state 跟更早那版 isOpening 的差別(當時卡死造成地圖整片空白的
  // 回歸根因):raf 的 id 存在 ref 裡,只在「面板關閉」或「元件卸載」時
  // 才取消,不在 effect cleanup 無條件取消——否則 openAnchorId 從 A 切到
  // B(捲動時面板跟著換錨點,見下方同步 effect)的 cleanup 會取消掉那個
  // 「把 growReady 設成 true」的回呼,新一輪又因為 wasOpen 已是 true 不
  // 再排程,面板就永久停在窄條狀態。切換錨點(開→開)不動 growReady、
  // class 不變,animation 不重播,維持「捲動時地圖不閃動」的既有行為;
  // 關閉時 growReady 立刻回到 false、wrap 同一個 commit 切成
  // visibility:hidden,整個面板(外框+內容)一起瞬間消失,不會有殘影。
  const prevOpenRef = useRef<string | null>(null);
  const growRafRef = useRef<number | null>(null);
  const [growReady, setGrowReady] = useState(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current !== null;
    prevOpenRef.current = openAnchorId;
    if (openAnchorId === null) {
      if (growRafRef.current !== null) {
        cancelAnimationFrame(growRafRef.current);
        growRafRef.current = null;
      }
      setGrowReady(false);
      return;
    }
    if (wasOpen) return;
    setGrowReady(false);
    growRafRef.current = requestAnimationFrame(() => {
      growRafRef.current = null;
      setGrowReady(true);
    });
  }, [openAnchorId]);
  useEffect(() => () => {
    if (growRafRef.current !== null) cancelAnimationFrame(growRafRef.current);
  }, []);

  // 面板開著時,捲動切換目前錨點要即時跟著移動中心點——只要面板目前是
  // 開著的(prev !== null),active 一變就把 id 同步成目前捲動到的錨點
  // id(模式維持不變),讓下方 focusedTheme 跟著重新計算、地圖自己 panTo
  // 過去。面板關著時(prev === null)維持不動,不會因為使用者捲動文案就
  // 自己把地圖打開。
  const currentId = order[active];
  useEffect(() => {
    setPanel((prev) => {
      if (prev === null || currentId === undefined || prev.id === currentId) return prev;
      return { id: currentId, mode: prev.mode };
    });
  }, [currentId]);

  // 預先載入所有已註冊錨點的縮圖——目前點欄位固定只有一個,捲動換到
  // 下一個錨點時是直接換這顆按鈕的 backgroundImage URL,不是重新掛載
  // 一個帶著自己縮圖的新節點。若不預先載圖,捲到一個縮圖還沒被瀏覽器
  // 抓過的錨點時,會先看到空白再彈出圖片(閃動)。用原生 Image() 物件
  // 觸發瀏覽器背景下載+快取,不掛進 DOM,純粹為了預熱快取。
  useEffect(() => {
    order.forEach((id) => {
      const meta = metaRef.current.get(id);
      if (!meta) return;
      const img = new Image();
      img.src = meta.thumb;
    });
  }, [order]);

  const ctxValue = useMemo<ScrollTimelineContextValue>(() => ({
    register,
    unregister,
    setNode,
    order,
    active,
    openAnchorId,
    toggleAnchor,
  }), [register, unregister, setNode, order, active, openAnchorId, toggleAnchor]);

  const prevId = active > 0 ? order[active - 1] : null;
  const nextId = active < order.length - 1 ? order[active + 1] : null;
  const currentMeta = currentId ? metaRef.current.get(currentId) : undefined;
  const openMeta = openAnchorId ? metaRef.current.get(openAnchorId) : undefined;
  // focusedTheme:目前開著的錨點指定的主題點名稱——defaultOpenTheme 這個
  // 共用退回值,只在這個錨點「完全沒有填 theme、也沒有填 center」時才
  // 套用(例如單一主題城市頁,所有錨點都不individually 指定,整頁共用
  // 同一個退回值,見該 prop 原本的設計意圖)。2026-10 修正(重要):原本
  // 這裡無條件 `openMeta?.theme ?? defaultOpenTheme`,導致有填 center
  // 但沒填 theme 的錨點(例如 TainanChikanPage.tsx 的武廟愛玉/神農街等
  // 7 站)一樣會落回 defaultOpenTheme(通常指向頁面唯一的主題點),這個
  // 回退值會在 InteractiveExploreMap 裡比對成功、整個蓋過下方
  // focusedCenter,導致地圖永遠黏在 defaultOpenTheme 那個點、7 站的
  // center 座標形同虛設,「地圖隨錨點移動」在這種混用 theme/center 的
  // 頁面上完全不會發生。修法:這個錨點只要填了 center,就不再退回
  // defaultOpenTheme(即使它沒填 theme),把決定權完全交給 focusedCenter。
  const focusedTheme = openMeta?.theme ?? (openMeta?.center ? undefined : defaultOpenTheme);
  // focusedCenter:目前開著的錨點若沒有填 theme(或 theme 比對不到主題點)
  // 時的備援——直接把錨點自己的原始座標交給 InteractiveExploreMap 的
  // focusedCenter prop(見該 prop 完整說明),讓地圖單純移動視角,不觸發
  // 開卡/附近景點揭露(那些效果只有真正的主題點才有)。openMeta 沒有
  // theme 時才傳,避免跟 focusedTheme 同時生效造成混淆(兩者同時有值時
  // InteractiveExploreMap 內部以 theme 優先)。
  const focusedCenter = openMeta && !openMeta.theme ? openMeta.center : undefined;

  const renderSideDot = (id: string | null) => {
    const meta = id ? metaRef.current.get(id) : undefined;
    if (!id || !meta) return <span className={styles.ghostDot} />;
    const isOpen = id === openAnchorId;
    return (
      <button
        type="button"
        className={`${styles.dot} ${isOpen ? styles.dotOpen : ''}`}
        onClick={() => toggleAnchor(id)}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? '關閉' : '展開'}「${meta.label ?? id}」的地圖`}
      />
    );
  };

  const isCurrentOpen = currentId === openAnchorId && currentId !== undefined;
  const currentMode: PanelMode | null = isCurrentOpen && panel ? panel.mode : null;

  // renderModeButton:按鈕組裡的一段——'map'/'nearby' 兩段共用同一套
  // 標記(圖示 + 文字 + aria),只差 mode/圖示/文字,抽成函式避免兩份
  // JSX 各自改到不同步。aria-pressed 表達「這一段目前是否為啟用中的
  // 模式」,比 aria-expanded 更貼近分段式按鈕的語意(展開/收合的是整個
  // 面板,個別段落是「選中/未選中」)。
  const renderModeButton = (mode: PanelMode, icon: ReactNode, text: string) => {
    if (!currentMeta || !currentId) return null;
    const pressed = currentMode === mode;
    const name = currentMeta.label ?? currentId;
    const target = mode === 'map' ? '地圖' : '附近景點清單';
    return (
      <button
        type="button"
        className={`${styles.modeButton} ${pressed ? styles.modeButtonActive : ''}`}
        onClick={() => toggleAnchor(currentId, mode)}
        aria-pressed={pressed}
        aria-label={`${pressed ? '關閉' : '展開'}「${name}」的${target}`}
        title={text}
      >
        {icon}
        <span className={styles.modeButtonLabel}>{text}</span>
      </button>
    );
  };

  return (
    <ScrollTimelineContext.Provider value={ctxValue}>
      {/* 2026-10 新增的最外層包裹——.root 是單欄 grid,.layout 跟
          .mapPanelWrap(見該元素下方的完整說明)是疊在同一個 grid area
          的兩個平行子元素。2026-10(第二版,fable 研究後修正):原本
          這裡是純 position:relative 容器,當 .mapPanelWrap 的
          position:absolute 定位參照;改成單欄 grid 疊層後,
          .mapPanelWrap 才能改回 position:sticky 正常運作(沒有
          containing block 被 grid 窄欄夾住的問題),詳見 CSS module
          .root/.mapPanelWrap 的完整說明。 */}
      {/* accentColor 透過 inline style 寫進 --timeline-accent,取代原本
          「呼叫端 CSS 自行定義同名變數」的隱性約定(見上方 accentColor
          prop 的完整說明)——CSS Custom Properties 可以直接當 inline
          style 的屬性名稱使用,React 的型別定義不預先知道這些動態
          名稱,故需要 as React.CSSProperties 繞過型別檢查。 */}
      <div className={styles.root} style={{ '--timeline-accent': accentColor } as CSSProperties}>
      <div className={styles.layout}>
        <aside className={styles.timeline}>
          <div className={styles.timelineTrack}>
            <div className={`${styles.node} ${styles.nodePrev}`}>{renderSideDot(prevId)}</div>

            {/* 目前點——唯一會顯示縮圖的欄位,位置/尺寸固定,捲動時只透過
                meta.thumb 的 URL 不同而換圖,不會有欄位本身的尺寸/位置
                變化。還沒有任何錨點註冊完成(currentMeta undefined,例如
                首次渲染的那一瞬間)時先不渲染按鈕,避免背景圖网址是
                undefined。 */}
            <div className={`${styles.node} ${styles.nodeCurrent} ${SHOW_NEARBY_LIST_BUTTON ? '' : styles.nodeCurrentSolo}`}>
              {currentMeta && currentId && (
                <div className={styles.currentDotWrap}>
                  <button
                    type="button"
                    className={`${styles.dot} ${isCurrentOpen ? styles.dotOpen : ''}`}
                    style={{ backgroundImage: `url(${currentMeta.thumb})` }}
                    onClick={() => toggleAnchor(currentId)}
                    aria-expanded={isCurrentOpen}
                    aria-label={`${isCurrentOpen ? '關閉' : '展開'}「${currentMeta.label ?? currentId}」的地圖`}
                  />
                  {/* modeGroup——放在目前點縮圖正下方的直排分段式按鈕組
                      (segmented control):上段「地圖」(放大鏡圖示,使用者
                      明確要求)、下段「附近景點」(清單圖示)。兩個動作開的
                      是同一個右側面板,差別只在深度(只移中心 vs 連帶顯示
                      附近景點清單,見檔案開頭 InteractiveExploreMap 掛載處
                      的 openCardOnFocus/themeCardNearbyOnly 說明),語意上
                      是「同一個面板的兩種模式」而非兩個不相干的功能,所以
                      用共用外框把它們框成一組、啟用中的那段填滿強調色,
                      而不是兩顆各自獨立的膠囊——獨立膠囊會讓人以為能同時
                      按亮兩個。直排而非左右並排,是因為時間軸欄位只有
                      96px 寬,兩段各自帶圖示+文字橫排塞不下,直排每段可以
                      保有完整文字。跟縮圖按鈕是獨立的 <button>(HTML 不
                      允許巢狀互動元素),縮圖按鈕不帶 mode 呼叫
                      toggleAnchor,沿用目前模式。role="group" + aria-label
                      讓讀屏器知道這兩顆是一組。SHOW_NEARBY_LIST_BUTTON 為
                      false 時(見該常數說明)只渲染「地圖」一段——分隔線
                      (.modeButton + .modeButton)是用相鄰兄弟選擇器畫的,
                      只剩一個子元素時自動不會畫出來,不需要額外處理;
                      外框高度則靠父層 .nodeCurrentSolo 調整(見上方
                      .node 容器)。 */}
                  {/* 2026-10:地圖面板展開時(openAnchorId 有值,不限於
                      目前這個錨點是否正是開著的那個)隱藏這顆膠囊狀按鈕
                      組——使用者明確要求展開地圖時把它收起來,展開中的
                      面板本身已經有獨立的 .mapPanelClose 關閉鈕可以收合,
                      不需要這顆按鈕繼續佔用時間軸縮圖下方的空間。
                      用 visibility(見 CSS module .modeGroupHidden)而非
                      條件渲染整個卸載——使用者明確提醒「不要讓旁邊的
                      元素改變大小跟位置」:.modeGroup 消失會讓
                      .currentDotWrap 少一個 flex 子元素、整體高度縮小,
                      父層 .nodeCurrent 的 justify-content:center 會把
                      縮圖重新置中,縮圖的垂直位置就會跟著跳動。
                      visibility:hidden 保留原本的版面佔位,縮圖位置不受
                      影響;關閉面板後(openAnchorId 為 null)自動恢復
                      顯示。 */}
                  <div
                    className={`${styles.modeGroup} ${openAnchorId ? styles.modeGroupHidden : ''}`}
                    role="group"
                    aria-label={`「${currentMeta.label ?? currentId}」的面板模式`}
                  >
                    {renderModeButton('map', <SearchIcon size={14} strokeWidth={2.25} aria-hidden="true" />, '地圖')}
                    {SHOW_NEARBY_LIST_BUTTON &&
                      renderModeButton('nearby', <ListIcon size={14} strokeWidth={2.25} aria-hidden="true" />, '附近景點')}
                  </div>
                </div>
              )}
            </div>

            <div className={`${styles.node} ${styles.nodeNext}`}>{renderSideDot(nextId)}</div>
          </div>
        </aside>

        <main className={styles.copy}>{children}</main>
      </div>

      {/* 地圖面板——.layout 外面的平行兄弟,不是 .layout 的 grid item,
          但跟 .layout 一起疊在 .root 這個外層單欄 grid 的同一個 grid
          area(見 .root 的完整說明)。
          2026-10(第三版,fable 研究後修正)根因回顧:手機版要「地圖
          展開時左右貼齊視窗滿版」,中間試過兩版都失敗——
          (1) .mapPanelWrap 還是 .layout 的 grid item 時,用
              left:50%;width:100vw;margin-left:-50vw 這組 breakout 寫法,
              只有左側改到。
          (2) 一度誤判成「grid item 的 width 被軌道鉗制」,改成
              position:absolute 相對 .root 定位解決滿版問題,但代價是
              .mapPanelWrap 失去 sticky 的黏住效果,捲動文案時面板會
              直接被帶走捲出視窗。
          fable 以 Playwright 在 Chromium/WebKit/Firefox 三引擎實測、
          對照 CSS Positioned Layout 3 §3.4 規範找到真正根因:
          position:sticky 元素的 left/right/width 不是「位移」,是
          「黏住時不能超出 containing block」的約束,套在 sticky 元素上
          不管哪種寫法都只會被推到 containing block 邊界卡住,跟
          grid item 身分本身無關(真正相關的是 grid item 的 containing
          block 範圍,也就是自己的 grid area)。能真正移動盒子本身
          位置/尺寸、不受這條約束限制的只有 margin。
          現在的解法:.root 改成單欄 grid,.mapPanelWrap 跟 .layout
          疊在同一格,.mapPanelWrap 的 containing block 因此變成 .root
          全寬,改回 position:sticky 正常運作;桌面版用 margin-left 對齊
          第 2 欄起點,手機版展開時用 margin-inline:calc(50% - 50vw)
          這組 full-bleed 手法真正貼齊視窗邊緣(見 CSS module
          .mapPanelWrap/.mapPanelOpen 的完整說明)。 */}
      <div
        className={`${styles.mapPanelWrap} ${openAnchorId ? styles.mapPanelOpen : styles.mapPanelHidden}`}
        aria-hidden={!openAnchorId}
      >
        <div
          className={`${styles.mapPanel} ${
            openAnchorId ? (growReady ? styles.mapPanelGrowing : styles.mapPanelGrowStart) : ''
          }`}
        >
          {/* mapPanelBody——地圖 + 關閉鈕的容器,絕對定位、寬度鎖在
              wrap 的最終全寬(100cqw,見 CSS module 該 class 的說明):
              外框 .mapPanel 長寬的過程中,這層的尺寸自始至終不變,
              Google Map 容器不會收到任何 resize,內容只是被外框的
              overflow:hidden 從時間軸那一側逐步露出;關閉鈕也因此
              一直停在最終位置,等外框長到那裡才被露出來,不會跟著
              外框右緣一路滑過去。 */}
          <div className={styles.mapPanelBody}>
            <button
              type="button"
              className={styles.mapPanelClose}
              onClick={() => setPanel(null)}
              aria-label="關閉地圖"
            >
              ×
            </button>
            <div className={styles.mapPanelInner}>
              {/* 刻意不傳 defaultOpenTheme 給 InteractiveExploreMap——那個
                  prop 是該元件自己的「資料載入完成就自動開卡一次」機制,
                  完全不受 openCardOnFocus 控制,一旦傳入,地圖只要載入完成
                  就會透過這條獨立路徑自動開卡,面板關著時卡片會先開在被
                  CSS 隱藏的面板裡。這個嵌入式小地圖要不要開卡,一律只透過
                  openCardOnFocus 這個受控管道決定(見該 prop 說明),不借用
                  defaultOpenTheme 的自動開卡行為——defaultOpenTheme 只在
                  這個檔案內部用來算 focusedTheme 的退回值(見上方
                  focusedTheme 的說明)。
                  openCardOnFocus 只在 'nearby' 模式為 true——'map' 模式與
                  面板關著時都是 false,InteractiveExploreMap 會在
                  true→false 時自己把卡片收起來(見該 prop 說明);
                  themeCardNearbyOnly 讓開出來的卡片只露出「附近景點」清單,
                  不顯示照片/名稱/簡介(見該 prop 說明)。
                  disableThemeCardOnMapClick:使用者明確要求這個嵌入式小
                  地圖完全不顯示主題點介紹卡——上面幾個 prop 管得住「捲動
                  /點時間軸錨點」這條路徑,但使用者也可能直接在小地圖上
                  手動點主題點圖標本身,那條路徑(handleAttractionSelect)
                  是獨立的,不受 openCardOnFocus 控制,這個 prop 補上這個
                  漏洞(見該 prop 完整說明)。
                  revealNearbyOnFocus 傳「面板是否開著」(不分 map/nearby
                  模式)——使用者明確要求「不管苗點(錨點)在哪,都要顯示
                  附近景點的小點」,地圖本身的附近景點標記不該侷限於比對到
                  某個特定主題點才揭露(見該 prop 完整說明)。
                  聚焦精選點的素色小圓點(2026-10,使用者要求「苗點在精選點
                  時,該點要變成(素色小圓點)圖標」):不需要額外 prop——
                  InteractiveExploreMap 收到 focusedCenter 後會自己拿座標去
                  比對 attractions 裡的精選點(誤差 0.0001 度內),命中的那
                  顆改畫聚焦造型(見該檔案 focusedAttractionId 的完整說明)。
                  呼叫端只要確保錨點的 center 座標跟資料庫記錄一致(例如
                  TainanChikanPage.tsx 的祀典武廟/林百貨直接複製資料庫座標)
                  就會自動生效;不在資料庫裡的錨點(神農街等)地圖上本來就
                  沒有對應標記,單純移動視角,不會憑空多出一顆點。
                  (2026-10 第二版:聚焦造型改成深紅色淚滴圖釘,見
                  geoAttractionOverlay.ts renderFocusedPin。)
                  themePhotoOnlyWhenFocused(2026-10,使用者要求「主題點只有
                  在主題點的苗點才顯示圓形圖,其他時候顯示小圓點」):只有
                  目前錨點指定的主題點(focusedTheme 比對到的那顆)顯示圓形
                  照片,其餘主題點退化成素色小圓點——捲到別的錨點時,沒人在
                  看的主題點不該繼續用大照片圓搶焦點。這是 opt-in,正式城市
                  頁不傳,主題點維持恆顯示照片(見該 prop 完整說明)。 */}
              <InteractiveExploreMap
                themePhotoOnlyWhenFocused
                city={city}
                showThemeToggle={false}
                focusedTheme={focusedTheme}
                focusedCenter={focusedCenter}
                openCardOnFocus={panel?.mode === 'nearby'}
                themeCardNearbyOnly
                disableThemeCardOnMapClick
                revealNearbyOnFocus={panel !== null}
                restrictRadiusKm={mapRestrictRadiusKm}
                // 關掉 Google 原生的 +/- 縮放鈕——260px 高的小面板裡,方形
                // 按鈕組貼右下角跟右上角的關閉鈕擠在一起很突兀;這個面板
                // 只是讓人瞥一眼位置,滾輪/雙指縮放仍可用(見該 prop 說明)。
                showZoomControl={false}
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </ScrollTimelineContext.Provider>
  );
}

// ScrollTimelineAnchor:放在文案裡任何位置的錨點標記——掛載時向
// <ScrollTimeline> 的 Context 註冊自己(id/thumb/theme/label/DOM 節點),
// 卸載時反註冊。children 是這個錨點對應的文案本身,完全自由排版(標題/
// 段落/圖片/任何巢狀結構皆可),這個元件不預設任何文案結構,只負責
//「這一整塊內容算是一個捲動錨點」這件事。
function ScrollTimelineAnchor({
  id,
  thumb,
  theme,
  center,
  label,
  children,
}: {
  id: string
  thumb: string
  theme?: string
  center?: { lat: number; lng: number }
  label?: string
  children: ReactNode
}) {
  const ctx = useScrollTimelineContext('Anchor');

  useEffect(() => {
    ctx.register({ id, thumb, theme, center, label });
    return () => ctx.unregister(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, thumb, theme, center?.lat, center?.lng, label]);

  return (
    <section ref={(el) => ctx.setNode(id, el)} className={styles.stop}>
      {children}
    </section>
  );
}

ScrollTimeline.Anchor = ScrollTimelineAnchor;
