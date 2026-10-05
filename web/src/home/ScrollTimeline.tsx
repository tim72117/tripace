import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { InteractiveExploreMap } from './InteractiveExploreMap';
import styles from './ScrollTimeline.module.css';

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
// 色票沿用 CityPageFooter.module.css/ExploreOtherCities.module.css 的
// 既有手法(見該二檔案開頭說明):不在這個元件內重新定義 --paper/--ink/
// --ink-soft/--line,直接讀呼叫端頁面作用域(各城市頁 .xxx-page class)
// 已經定義好的同名變數;強調色改用這個元件專屬的中性變數名
// --timeline-accent(同 --footer-accent/--explore-accent 的既有模式)。

// AnchorMeta:Context 登記簿裡每個錨點存的中繼資料——id 是穩定識別碼
// (呼叫端自訂,註冊/反註冊/IntersectionObserver 比對整個靠它),thumb
// 是時間軸圓形縮圖網址,theme 是這個錨點對應地圖上哪個主題點的人類
// 可讀名稱(選填,未填時退回 <ScrollTimeline defaultOpenTheme>),label
// 是地圖開關按鈕 aria-label 用的簡短可讀文字(選填,未填退回 id 本身
// ——Anchor 的 children 是自由排版的 JSX,不保證抽得出一句話當文字
// 描述,故不強制要求)。
interface AnchorMeta {
  id: string
  thumb: string
  theme?: string
  label?: string
}

interface ScrollTimelineContextValue {
  register: (meta: AnchorMeta) => void
  unregister: (id: string) => void
  setNode: (id: string, el: HTMLElement | null) => void
  order: string[]
  active: number
  openAnchorId: string | null
  toggleAnchor: (id: string) => void
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
  // defaultOpenTheme:沒有在個別 <ScrollTimeline.Anchor theme="..."> 指定
  // 時的共用退回值——單一主題城市頁(例如九份只有「九份老街」一個主題
  // 點)不需要每個錨點都重複填同一個名稱。
  defaultOpenTheme,
}: {
  children: ReactNode
  city: string
  defaultOpenTheme?: string
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

  // openAnchorId:目前被點開地圖的錨點 id(null 表示沒有任何一個打開)
  // ——用 id 而非單純布林值,因為任一時刻最多只能有一個地圖面板打開
  // (點開另一個縮圖時直接切換過去,不會同時疊出兩個面板),id 本身就
  // 足夠表達「目前是哪一個」,不需要額外的陣列/索引狀態。
  const [openAnchorId, setOpenAnchorId] = useState<string | null>(null);
  const toggleAnchor = useCallback((id: string) => {
    setOpenAnchorId((prev) => (prev === id ? null : id));
  }, []);

  // 地圖開著時,捲動切換目前錨點要即時跟著移動中心點——只要面板目前是
  // 開著的(prev !== null),active 一變就把 openAnchorId 同步成目前捲動
  // 到的錨點 id,讓下方 focusedTheme 跟著重新計算、地圖自己 panTo 過去。
  // 面板關著時(prev === null)維持不動,不會因為使用者捲動文案就自己
  // 把地圖打開。
  const currentId = order[active];
  useEffect(() => {
    setOpenAnchorId((prev) => {
      if (prev === null) return prev;
      return currentId ?? prev;
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
  const focusedTheme = openMeta?.theme ?? defaultOpenTheme;

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

  return (
    <ScrollTimelineContext.Provider value={ctxValue}>
      <div className={styles.layout}>
        <aside className={styles.timeline}>
          <div className={styles.timelineTrack}>
            <div className={`${styles.node} ${styles.nodePrev}`}>{renderSideDot(prevId)}</div>

            {/* 目前點——唯一會顯示縮圖的欄位,位置/尺寸固定,捲動時只透過
                meta.thumb 的 URL 不同而換圖,不會有欄位本身的尺寸/位置
                變化。還沒有任何錨點註冊完成(currentMeta undefined,例如
                首次渲染的那一瞬間)時先不渲染按鈕,避免背景圖网址是
                undefined。 */}
            <div className={`${styles.node} ${styles.nodeCurrent}`}>
              {currentMeta && currentId && (
                <button
                  type="button"
                  className={`${styles.dot} ${isCurrentOpen ? styles.dotOpen : ''}`}
                  style={{ backgroundImage: `url(${currentMeta.thumb})` }}
                  onClick={() => toggleAnchor(currentId)}
                  aria-expanded={isCurrentOpen}
                  aria-label={`${isCurrentOpen ? '關閉' : '展開'}「${currentMeta.label ?? currentId}」的地圖`}
                />
              )}
            </div>

            <div className={`${styles.node} ${styles.nodeNext}`}>{renderSideDot(nextId)}</div>
          </div>
        </aside>

        {/* 地圖面板——跟 .copy 共用同一個 grid 欄(見 CSS module 的
            grid-column 設定),視覺上「從時間軸向右展開」,寬度跟文案欄
            同寬。position: sticky 讓它在捲動時跟時間軸一樣固定在視窗內
            的垂直位置,不隨文案捲動跑走。這個元素(連同內部的
            InteractiveExploreMap)一開始就常駐掛載,開關狀態用
            .mapPanelHidden 這個 CSS class 切換,而不是條件渲染整個卸載
            ——每次點開地圖才 mount 等於每次都重新建一次 Google Map
            實例、重新打一次查詢 API,開銷不小;常駐掛載後切換錨點只是
            改變 focusedTheme prop,地圖元件自己把視角移過去。 */}
        <div className={`${styles.mapPanel} ${openAnchorId ? '' : styles.mapPanelHidden}`} aria-hidden={!openAnchorId}>
          <button
            type="button"
            className={styles.mapPanelClose}
            onClick={() => setOpenAnchorId(null)}
            aria-label="關閉地圖"
          >
            ×
          </button>
          <div className={styles.mapPanelInner}>
            <InteractiveExploreMap city={city} showThemeToggle={false} defaultOpenTheme={defaultOpenTheme} focusedTheme={focusedTheme} />
          </div>
        </div>

        <main className={styles.copy}>{children}</main>
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
  label,
  children,
}: {
  id: string
  thumb: string
  theme?: string
  label?: string
  children: ReactNode
}) {
  const ctx = useScrollTimelineContext('Anchor');

  useEffect(() => {
    ctx.register({ id, thumb, theme, label });
    return () => ctx.unregister(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, thumb, theme, label]);

  return (
    <section ref={(el) => ctx.setNode(id, el)} className={styles.stop}>
      {children}
    </section>
  );
}

ScrollTimeline.Anchor = ScrollTimelineAnchor;
