import { Fragment, useCallback, useState } from 'react'
import type { MutableRefObject, Ref, ReactNode, UIEventHandler } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bike, Car, Footprints } from 'lucide-react'
import type { PlanNode } from './planTimeline'
import styles from './PlanTimelineView.module.css'

// PlanTimelineView — 2026-10 從 trip-plan/TripPlanPage.tsx 拆出來的時間軸
// 視圖本體(使用者明確要求「先將正式畫面的排程時間軸UI拆成獨立元件」),
// 放進 plan-core/ 跟 planTimeline.ts(純資料層)放在一起——這裡只負責
// 「把一條 PlanNode 陣列畫成時間軸」這件事本身(空狀態/卡片/軸線/交通/
// 備註/訊息/骨架/呼吸點/「回到最新」浮動按鈕),不含 header、composer
// 輸入框、右上角小地圖——那些是外殼頁面(TripPlanPage.tsx)自己的職責,
// 不屬於時間軸視圖。
//
// 之所以現在拆出來,是為了讓 /ai-plan 展示頁(home/plan-ai-sim/
// AIPlanTimelinePage.tsx)有機會重用同一份渲染邏輯——該檔案原本是獨立
// 複製的一份幾乎相同的 JSX,任何 UI 調整(例如 2026-10 新增的多圖瀏覽)
// 都必須兩邊分別修改才會同時生效。拆分本身分兩階段:第一階段只整理
// TripPlanPage.tsx(使用者當時明確要求先不要動 AIPlanTimelinePage.tsx);
// 第二階段(同一天,使用者明確要求「展示頁使用 PlanTimelineView」)
// 展示頁也改接這個共用元件——兩個頁面的差異(結尾文案、捲動容器歸屬、
// 「回到最新」按鈕定位方式)透過 endMarkerMessage/scrollClassName/
// jumpPillWrapClassName 這幾個選填 prop 讓呼叫端各自覆寫,不靠在這裡
// 分支判斷「現在是哪個頁面」。
//
// NOTE_STYLES——備註分類→顏色/圖示的固定對照表,原本定義在
// TripPlanPage.tsx,跟著 JSX 一起搬過來,因為只有這裡的渲染邏輯會用到。
const NOTE_STYLES: Record<string, { color: string; noteIcon: string }> = {
  consideration: { color: 'var(--ios-gray)', noteIcon: '✦' },
  info: { color: 'var(--ios-sand)', noteIcon: 'ⓘ' },
  cost: { color: 'var(--ios-green)', noteIcon: '💰' },
  weather: { color: 'var(--ios-blue)', noteIcon: '☁︎' },
}
const DEFAULT_NOTE_CATEGORY = 'info'

export interface PlanTimelineViewProps {
  steps: PlanNode[]
  isThinking: boolean
  emptyStateMessage: string
  // endMarkerMessage——選填,生成結束後顯示在時間軸底部的文案,預設
  // 「目前安排到這裡」(對齊正式頁 TripPlanPage.tsx 開放式、可持續對話
  // 調整行程的語意)。展示頁 AIPlanTimelinePage.tsx 原本固定顯示
  // 「行程結束」(劇本播完、語意上是一段有限的展示跑完了,跟正式頁
  // 「隨時可以繼續安排」的語意不同)——2026-10 code review 發現拆分
  // 當下把這段文字寫死成正式頁的版本,展示頁因此文案被覆蓋,改成這個
  // 選填 prop 讓兩邊各自傳入自己的措辭。
  endMarkerMessage?: string
  selectedStopId: string | null
  showJumpPill: boolean
  onJumpToLatest: () => void
  onPanToStop: (step: PlanNode) => void
  // onHoverStop——滑鼠移入/移出站點卡時回報是哪一站(移出時傳 null),
  // 2026-10 新增:使用者明確要求「滑鼠移動到介紹卡時,地圖圓加強顯示」。
  // 選填——/ai-plan 展示頁等沒有地圖的使用情境不需要這個回報。
  onHoverStop?: (id: string | null) => void
  onOpenPhotos: (photos: { photos: string[]; alt: string }) => void
  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,呼叫端
  // (TripPlanPage.tsx)擁有這個 ref 的生命週期,這裡只負責讀寫其內容,
  // 理由同原本直接內嵌在該檔案時的完整說明:用 id 而非陣列 index 判斷
  // justMounted,插入到中間的節點才能正確觸發進場動畫。
  mountedIdsRef: MutableRefObject<Set<string>>
  scrollRef?: Ref<HTMLDivElement>
  // onScroll——選填:展示頁(/ai-plan)的捲動容器就是這個元件自己渲染的
  // .scroll(onScroll 直接掛在這個 div 上判斷是否還跟隨最新節點),跟正式
  // 頁(TripPlanPage.tsx)不同——後者的真正捲動容器收在外層 <main>
  // (DesktopMain 的 unboundedScroll,見該檔案的完整說明),這個元件的
  // .scroll 只是流動內容、不綁 onScroll。兩邊捲動模型不同,用這個可選
  // prop 讓展示頁接上自己的 handleScroll,正式頁不傳就維持原狀。
  onScroll?: UIEventHandler<HTMLDivElement>
  // scrollClassName——選填,疊加在這個元件自己的 .scroll 上。兩個呼叫端
  // 的捲動模型完全不同:正式頁 TripPlanPage.tsx 的 .page 是自然高度、
  // 捲動權收在外層 <main>(unboundedScroll),.scroll 本身不需要
  // overflow-y/padding-bottom;展示頁 AIPlanTimelinePage.tsx 的 .page 是
  // height:100dvh + overflow:hidden 的固定視窗容器,.scroll 自己才是
  // 真正的捲動容器,需要 overflow-y:auto,composer 又是 position:absolute
  // 蓋在內容上方,還需要額外的 padding-bottom 讓最後一張卡片捲到底時
  // 不被蓋住。2026-10 這兩條 CSS 規則一度被拆分成共用元件本身固定的
  // .scroll(只含正式頁需要的 flex/padding),展示頁因此完全失去捲動
  // 能力(使用者實測回報「展示頁往下安排時不能往下拉了」)——改成由
  // 呼叫端各自傳入自己需要的 class 疊加上去,不讓共用元件替兩種完全不同
  // 的捲動模型做決定。
  scrollClassName?: string
  // jumpPillWrapClassName——選填,疊加在這個元件自己的 .jumpPillWrap 上。
  // 跟 scrollClassName 同一種需要的理由:共用元件的 .jumpPillWrap 用
  // position:sticky(相對「最近的捲動祖先」貼齊,見該 class 的完整
  // 說明),這個寫法要求 .jumpPillWrap 的某個祖先元素本身是可捲動的
  // ——正式頁 TripPlanPage.tsx 符合這個前提(捲動祖先是外層 <main>,
  // 整棵 .page 樹都在它底下)。但展示頁 AIPlanTimelinePage.tsx 的
  // .jumpPillWrap 是 PlanTimelineView 自己 .scroll(透過 scrollClassName
  // 取得 overflow-y:auto)的手足元素、不是它的子孫——sticky 完全沒有
  // 可依附的捲動容器,按鈕會變成普通區塊顯示、不再浮動貼齊畫面底部
  // (2026-10 code review 抓到的回歸,使用者尚未實際回報但已確認會
  // 發生)。改成由呼叫端疊加自己需要的定位方式:展示頁傳入的
  // class 比照原本的寫法(position:absolute 相對 .page 置中定位),不
  // 依賴 sticky。
  jumpPillWrapClassName?: string
  // jumpPillClassName——選填,疊加在按鈕本身(.jumpPill)上。2026-10
  // 新增:正式頁對話小匡(compact)使用者要求「太扁太寬,且要用 icon
  // 不要用文字的箭頭」——小匡只有 440px 寬,文字膠囊(padding:8px 16px
  // + 「↓ 回到最新」五個字)比例上太寬太扁;全頁版維持原本的文字膠囊,
  // 不需要跟著改。
  jumpPillClassName?: string
  // jumpPillContent——選填,覆寫按鈕內部內容(預設「↓ 回到最新」文字)。
  // 跟 jumpPillClassName 搭配使用:小匡版傳一個只有 icon 的 ReactNode,
  // 不重新定義另一顆按鈕元件——這個元件仍然只有一個 <button>,只是
  // 內容跟外觀由呼叫端決定,維持「這個元件不知道自己在哪種容器裡」的
  // 既有設計慣例(同 scrollClassName/jumpPillWrapClassName)。
  jumpPillContent?: ReactNode
}

// PlanTimelineView — 純渲染元件,不持有自己的 state/effect(scroll 追蹤、
// 429 重試、照片重試等邏輯仍留在呼叫端),只依賴傳入的 props 畫出時間軸
// 與「回到最新」浮動按鈕。
// TRANSIT_MODE_ICONS——交通 pill 用 lucide SVG 圖示取代資料層回傳的
// emoji(icon 欄位不動,改用 mode 查表)。
const TRANSIT_MODE_ICONS: Record<string, typeof Footprints> = {
  '步行': Footprints,
  '騎車': Bike,
  '開車': Car,
}

export function PlanTimelineView({
  steps,
  isThinking,
  emptyStateMessage,
  endMarkerMessage = '目前安排到這裡',
  selectedStopId,
  showJumpPill,
  onJumpToLatest,
  onPanToStop,
  onHoverStop,
  onOpenPhotos,
  mountedIdsRef,
  scrollRef,
  onScroll,
  scrollClassName,
  jumpPillWrapClassName,
  jumpPillClassName,
  jumpPillContent,
}: PlanTimelineViewProps) {
  // failedPhotoUrls——載入失敗(404/403/過期/網路錯誤)的照片 URL 集合。
  //
  // 2026-10 使用者實際回報:縮圖位置出現破圖 icon 疊著 alt 文字(例如
  // 「全美戲院」四個字擠在 64px 圓形縮圖裡),而不是乾淨的佔位。原因是
  // 這裡的 <img> 沒有 onError——googlePhotoUrls 有值就一律渲染 <img>,
  // URL 本身載入失敗時瀏覽器顯示的就是那個破圖樣式;更糟的是
  // .stopThumb 的 thumbBg 底色在「有 googlePhotoUrls」時被判斷式關掉
  // (見下方 style),所以連底色都沒有,破圖直接疊在透明背景上。
  //
  // photo_assets 的 7 天過期機制(見後端 photoAssetExpiry)讓這不是罕見
  // 邊界情況:節點是持久化的(planTimelineStorage.ts),時間軸可以存在
  // 遠比 7 天更久,舊節點裡的 URL 失效是預期中會發生的事。
  //
  // 用 URL 字串(而非節點 id)當 key——同一張照片可能出現在多個節點,
  // 失敗一次就不需要在其他節點重試;節點 id 則會因為重新插入而改變。
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<ReadonlySet<string>>(() => new Set())
  const markPhotoFailed = useCallback((url: string) => {
    setFailedPhotoUrls((prev) => {
      // 已經記錄過就回傳原本的 Set——onError 可能因為重新渲染而重複觸發,
      // 每次都產生新 Set 會造成不必要的重渲染迴圈。
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }, [])

  return (
    <>
      <div className={`${styles.scroll} ${scrollClassName ?? ''}`} ref={scrollRef} onScroll={onScroll}>
        <div className={styles.inner}>
          {/* emptyState——時間軸完全空白、也還沒開始生成時的引導文字。
              isThinking 為 true 時不顯示——那個情況下面已經有呼吸點/
              骨架卡(.tipRow)傳達「正在安排」的狀態,不需要空狀態文字跟
              生成動畫同時出現互相干擾。 */}
          {steps.length === 0 && !isThinking && (
            <div className={styles.emptyState}>
              <span className={styles.emptyStateIcon}>✦</span>
              <p className={styles.emptyStateText}>{emptyStateMessage}</p>
            </div>
          )}
          {steps.map((p, idx) => {
            // justMounted:這個節點是不是「第一次」出現在畫面上——用 id
            // 是否已經記錄過判斷,不是用陣列 index,插入到中間的節點
            // 才能正確觸發進場動畫。
            const justMounted = !mountedIdsRef.current.has(p.id)
            if (justMounted) mountedIdsRef.current.add(p.id)
            const mountedClass = styles.mountFadeIn
            // removingClass:套在每個節點最外層的 .row 容器上,CSS 同時
            // 做透明度淡出跟高度塌縮。
            const removingClass = p.removing ? styles.removingFade : ''
            // usablePhotos——濾掉已知載入失敗的 URL(見 failedPhotoUrls
            // 的完整說明)。整組都失敗時長度為 0,縮圖的判斷式自然退回
            // thumbIcon + thumbBg 佔位,跟「這個地點本來就沒有照片」是
            // 同一條路徑,不需要額外的錯誤樣式。Lightbox 收到的也是這份
            // 濾過的清單,不會點開後翻到破圖。
            const usablePhotos = p.googlePhotoUrls?.filter((u) => !failedPhotoUrls.has(u)) ?? []

            if (p.type === 'section') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.sectionRow} ${mountedClass} ${removingClass}`}>
                  <div className={styles.sectionBand}>
                    <span className={styles.sectionLabel}>{p.label}</span>
                  </div>
                </div>
              )
            }

            if (p.type === 'stop') {
              // transitFromPrev(見 planTimeline.ts TransitInfo 的完整
              // 說明)掛在到達站自己身上——渲染時在這張 stop 卡片「之前」
              // 多畫一列交通卡,key 加 "transit-" 前綴避免跟下面 stop
              // 本身的 key(p.id)衝突。
              const transit = p.transitFromPrev
              // note——這個節點自己的備註(見 planTimeline.ts NoteInfo
              // 的完整說明),掛在這張 stop 卡片自己身上的欄位,渲染時在
              // 卡片之前多畫一列。
              const note = p.note
              const noteStyle = note ? NOTE_STYLES[note.category ?? ''] ?? NOTE_STYLES[DEFAULT_NOTE_CATEGORY] : null
              return (
                <Fragment key={p.id}>
                  {note && noteStyle && (
                    <div className={`${styles.row} ${styles.noteRow}`}>
                      <div className={`${styles.noteLeft} ${mountedClass} ${justMounted ? styles.noteFade : ''}`}>
                        <div className={styles.noteInner}>
                          <div className={styles.noteBar} style={{ background: noteStyle.color }} />
                          <div className={styles.noteText}>
                            <span style={{ marginRight: 4 }}>{noteStyle.noteIcon}</span>{note.text}
                          </div>
                        </div>
                      </div>
                      <div className={styles.noteAxisCol}>
                        <div className={styles.noteAxisLine} />
                      </div>
                      <div />
                    </div>
                  )}
                  {transit && (
                    <div className={`${styles.row} ${styles.transitRow}`}>
                      <div />
                      <div className={styles.transitAxis}>
                        <div className={styles.transitDashAbove} />
                        <div className={styles.transitDashBelow} />
                        <div className={`${mountedClass} ${justMounted ? styles.pillExpand : ''} ${styles.transitPill}`}>
                          {/* 查詢中(loading:true)只顯示轉圈動畫,不顯示
                              任何文字,重用 stop 卡片查詢中狀態既有的
                              thumbSpinner 動畫。 */}
                          {transit.loading ? (
                            <span className={styles.thumbSpinner} aria-label="查詢交通資訊中" />
                          ) : (
                            <>
                              {(() => {
                                const TransitIcon = (transit.mode && TRANSIT_MODE_ICONS[transit.mode]) || Footprints
                                return <TransitIcon size={13} strokeWidth={2} aria-hidden="true" />
                              })()}
                              <span>
                                {transit.mode} {transit.minutes} 分
                                <span className={styles.transitSep}>·</span>
                                {transit.distance}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div />
                    </div>
                  )}
                  <div data-tl-node className={`${styles.row} ${styles.stopRow} ${removingClass}`}>
                    <div className={`${styles.stopTime} ${mountedClass}`}>
                      <div className={styles.stopTimeText}>{p.time}</div>
                    </div>
                    <div className={styles.axisCol}>
                      {idx > 0 && <div className={styles.axisLineAbove} />}
                      {/* axisLineBelow——「還有下一個節點」或「正在生成中」
                          任一成立時都畫出來,避免最後一張卡片下方到呼吸點
                          之間出現斷裂。 */}
                      {(idx < steps.length - 1 || isThinking) && <div className={styles.axisLineBelow} />}
                      <div className={`${styles.anchorDot} ${mountedClass} ${justMounted ? styles.anchorPop : ''}`} />
                    </div>
                    <div className={`${styles.stopCardWrap} ${mountedClass} ${justMounted ? styles.cardSlide : ''}`}>
                      <div
                        className={`${styles.stopCard} ${p.id === selectedStopId ? styles.stopCardSelected : ''}`}
                        role={p.lat != null && p.lng != null ? 'button' : undefined}
                        tabIndex={p.lat != null && p.lng != null ? 0 : undefined}
                        onClick={() => onPanToStop(p)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') onPanToStop(p)
                        }}
                        // onMouseEnter/Leave——地圖上對應的圓點加強顯示
                        // (見 onHoverStop 的完整說明)。onFocus/onBlur
                        // 一併接上:這張卡片在有座標時是 tabIndex=0 的可
                        // 聚焦元素,鍵盤使用者 Tab 到這裡時應該得到跟滑鼠
                        // 懸停一樣的回饋,不是只有滑鼠使用者看得到地圖
                        // 在哪一顆點上。
                        onMouseEnter={() => onHoverStop?.(p.id)}
                        onMouseLeave={() => onHoverStop?.(null)}
                        onFocus={() => onHoverStop?.(p.id)}
                        onBlur={() => onHoverStop?.(null)}
                      >
                        <div
                          className={`${styles.stopThumb} ${justMounted ? styles.thumbPop : ''}`}
                          style={{ background: usablePhotos.length ? undefined : p.thumbBg }}
                        >
                          {p.loading ? (
                            <span className={styles.thumbSpinner} aria-label="查詢地點資料中" />
                          ) : usablePhotos.length ? (
                            // 縮圖本身維持只顯示第一張(64px 圓形版型)。
                            // 只要有照片就能點擊開啟全螢幕 Lightbox 放大
                            // 瀏覽——即使只有 1 張,使用者明確要求「一張
                            // 的時候也要」能點開看大圖,不是只有 2 張以上
                            // 才可互動。不冒泡觸發卡片本身的 onPanToStop
                            // ——瀏覽照片跟點卡片置中地圖是兩個不同意圖
                            // 的操作。張數角標只在有 2 張以上時顯示,提示
                            // 使用者這張縮圖還有更多照片可以切換;1 張時
                            // 不顯示角標,但按鈕本身仍可點擊,Lightbox 內
                            // 不會出現左右切換箭頭/頁碼(見 Lightbox 的
                            // 完整說明,photos 陣列只有 1 項時那些控制項
                            // 本來就不需要)。
                            <button
                              type="button"
                              className={styles.stopThumbPhotoBtn}
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenPhotos({ photos: usablePhotos, alt: p.name ?? '' })
                              }}
                              aria-label={
                                usablePhotos.length > 1
                                  ? `瀏覽 ${usablePhotos.length} 張照片`
                                  : '放大檢視照片'
                              }
                            >
                              {/* onError——載入失敗時把這個 URL 記進
                                  failedPhotoUrls(見該 state 的完整說明),
                                  下次渲染 usablePhotos 就會濾掉它;整組都
                                  失敗時整張縮圖退回 thumbIcon + thumbBg
                                  佔位,不是破圖疊 alt 文字。 */}
                              <img
                                src={usablePhotos[0]}
                                alt={p.name}
                                className={styles.stopThumbImg}
                                onError={() => markPhotoFailed(usablePhotos[0])}
                              />
                              {usablePhotos.length > 1 && (
                                <span className={styles.stopThumbPhotoCount}>{usablePhotos.length}</span>
                              )}
                            </button>
                          ) : p.thumbIcon}
                        </div>
                        <div className={styles.stopBody}>
                          <div className={styles.stopMeta}>
                            {p.duration} · {p.kind}
                            {p.loading && <span className={styles.loadingTag}>查詢地點中…</span>}
                          </div>
                          <div className={styles.stopName}>{p.name}</div>
                          <div className={styles.stopDesc}>{p.desc}</div>
                          {p.tags && p.tags.length > 0 && (
                            <div className={styles.stopTags}>
                              {p.tags.map((tag) => (
                                <span key={tag} className={styles.stopTag}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Fragment>
              )
            }

            // message——LLM/使用者的對話訊息(見 planTimeline.ts
            // PlanNodeType 的完整說明),時間軸上自己獨立的一列,不依附
            // 任何 stop 卡片。新的 stop 節點插入後(p.stale === true)
            // 收合成一行淡化的小字,不整個移除。
            if (p.type === 'message') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.messageRow} ${mountedClass} ${removingClass}`}>
                  <div />
                  <div className={styles.messageAxisCol}>
                    <div className={styles.messageAxisLine} />
                  </div>
                  <div className={styles.messageWrap}>
                    <div className={`${styles.messageBubble} ${p.stale ? styles.messageBubbleStale : ''}`}>
                      {/* stale(收合淡化態)是單行省略號截斷的純文字——
                          markdown 排版在那個高度/寬度下沒有意義。新鮮態
                          才用 ReactMarkdown 渲染完整內容。 */}
                      {p.stale ? (
                        p.text
                      ) : (
                        <div className={styles.messageMarkdown}>
                          <ReactMarkdown>{p.text ?? ''}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })}

          {/* isThinking——onagent 對話推論中(唯一的「AI 正在做事」訊號
              來源)。 */}
          {isThinking ? (
            // key 綁「目前最後一個節點的 id」,讓「最後一個節點變了」
            // 等同「呼吸點換了位置」,強制 React 卸掉舊的 tipRow 重新掛
            // 一個,CSS 動畫才會隨之重播。
            <Fragment key={`tip-after-${steps.length > 0 ? steps[steps.length - 1].id : 'empty'}`}>
              <div data-tl-tip className={`${styles.row} ${styles.tipRow}`}>
                <div />
                <div className={styles.tipAxis}>
                  <div className={styles.tipLineAbove} />
                  <div className={styles.tipDot} />
                  <div className={styles.tipLineBelow} />
                </div>
                <div />
              </div>
              {/* 骨架卡——呼吸點下方的「即將出現的內容」預告,只在已經有
                  節點之後才顯示。 */}
              {steps.length > 0 && (
                <div aria-hidden="true" className={`${styles.row} ${styles.stopRow} ${styles.skeletonRow}`}>
                  <div />
                  <div className={styles.axisCol}>
                    {/* skeletonAxisAbove——骨架卡列自己補一段貫穿到
                        .skeletonAnchor 中點的虛線,不依賴上一列
                        .tipLineBelow 用魔術數字猜測骨架卡列高度往下
                        穿透。 */}
                    <div className={styles.skeletonAxisAbove} />
                    <div className={styles.skeletonAnchor} />
                  </div>
                  <div className={styles.stopCardWrap}>
                    <div className={styles.skeletonCard}>
                      <div className={`${styles.skeletonThumb} ${styles.shimmer}`} />
                      <div className={styles.skeletonBody}>
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineMeta} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineTitle} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineDesc} ${styles.shimmer}`} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          ) : steps.length > 0 ? (
            <div className={`${styles.endMarker} ${styles.endFade}`}>── {endMarkerMessage} ──</div>
          ) : null}
        </div>
      </div>

      {showJumpPill && (
        <div className={`${styles.jumpPillWrap} ${jumpPillWrapClassName ?? ''}`}>
          <button
            type="button"
            className={`${styles.jumpPill} ${jumpPillClassName ?? ''}`}
            onClick={onJumpToLatest}
            aria-label="回到最新"
          >
            {jumpPillContent ?? '↓ 回到最新'}
          </button>
        </div>
      )}
    </>
  )
}
