import { useEffect, useState } from 'react'
import { Check, MapPin } from 'lucide-react'
import type { AskPageCandidate, AskPageSelection } from '../../plan-core/askPageTools'
import type { PlanAiDataSource } from './planAiDataSource'
import styles from './AskPage.module.css'

// ScriptedAskPage.tsx — 播放態專用的候選景點詢問頁,用來「置換」正式的
// AskPage(見 AskPage.tsx)。2026-10 新增(使用者明確要求「ask page 內的
// 感興趣的景點詢問,可以用挖洞的方式,再撥放態置換成可以由腳本控制的
// 原件」、「置換的元件本身要可以做到模擬選項被點擊發出顯眼的特效」、
// 「所以是要做在被置換的原件上,與正式使用的不一樣」)。
//
// 為什麼是獨立元件,不是在 AskPage 裡加一個 scripted 分支:
// 這兩者只有「長得一樣」這一點重疊,行為是相反的——
//   正式(AskPage/CandidatesPanel):使用者點卡片切換勾選、按「確認選擇」
//     送出。勾選狀態是使用者的輸入,元件不知道他會選什麼。
//   播放態(這個檔案):劇本指定選哪幾張、依序演出點擊特效、時間到自己
//     送出。勾選狀態是劇本的輸出,沒有任何真實輸入。
// 塞進同一個元件的話,那個元件會同時裝著兩套 state(真人的
// selectedPlaceIds 與腳本的進度計數)、兩條時間線,而每一處互動點都要
// 判斷「現在是哪一種模式」。正式路徑是會上線的功能,不該為了展示背這些
// 分支——它的每一條分支都是真實使用者會踩到的路徑,多一條就多一份要
// 驗證的組合。
//
// 共用的是 AskPage.module.css(直接 import 同一份):候選卡片的尺寸、
// 勾選樣式、標題與氣泡外殼在兩邊必須一模一樣,否則播放態演的就不是
// 真實畫面。只有點擊特效是這個檔案獨有的(見 .scriptedPicking /
// .scriptedRipple)——正式路徑沒有「被程式點擊」這種狀態,不需要那組
// 樣式。
//
// 不共用照片背景查詢那段 effect——雖然邏輯幾乎一樣,但播放態的
// dataSource 固定是 planAiFakeDataSource(見該檔案檔頭:資料來源是寫死
// 的 10 筆台南景點,不打後端),也沒有 explore 探查模式。抽成共用 hook
// 反而要讓那個 hook 同時服務兩種差很多的情境。

// PICK_INTERVAL_MS——兩次點擊之間的間隔。
//
// 520ms 的取法:比卡片本身的視覺轉場(AskPage.module.css .directionCard
// 的 0.12s transition)長得多——點擊之間要看得出是「一次、又一次」的
// 獨立動作,不是一次群組動畫;又明顯短於單則劇本動作的 randomDelayMs
// (900~1500ms,見 planSimFakeSource.ts),因為這幾次點擊合起來只是劇本
// 裡「一步」的內容,不該比一整步還久。
const PICK_INTERVAL_MS = 520

// PICK_EFFECT_MS——單次點擊特效的長度,必須跟 AskPage.module.css
// .scriptedPicking 的 animation duration 一致(那邊是 440ms)。不一致的
// 後果:短於動畫長度會讓特效播一半被截斷;長於動畫長度會讓卡片停在
// 動畫結束後的狀態上一小段時間才回復。
const PICK_EFFECT_MS = 440

// CONFIRM_PRESS_MS——「確認選擇」按鈕被按下的特效長度,必須跟
// AskPage.module.css .scriptedPressing 的 animation duration 一致。
const CONFIRM_PRESS_MS = 260

export interface ScriptedAskPageProps {
  // dataSource——查候選完整資料(照片、正式名稱)用。播放態固定傳
  // planAiFakeDataSource,見檔頭的完整說明。
  dataSource: PlanAiDataSource
  // candidates——要顯示的候選景點卡片,來自劇本的 PlanAction.candidates
  // (見 home/plan-ai-sim/Content.tsx 該欄位的完整說明)。
  candidates: AskPageCandidate[]
  // picks——要依序演出被點擊的 placeId,陣列順序就是點擊順序。空陣列
  // 是合法的(開了選單但一張都沒點,之後送出空選擇)。值必須是
  // candidates 裡的 placeId,劇本自己負責對齊——這裡不驗證,對齊
  // PlanAction.afterId 的既有處理方式(劇本送出無效的值是劇本自己的
  // bug,應該在畫面上看得出來,不是靜默吃掉)。
  picks: string[]
  // reason——取代預設標題的一句話,語意同正式 AskPage 的 input.reason。
  reason?: string
  // onDone——演出結束時觸發,帶 picks 對應的選擇結果。形狀跟正式
  // AskPage 的同名 prop 完全一致,所以兩者在呼叫端可以直接互換。
  onDone: (selected: AskPageSelection[]) => void
  // confirmAfterMs——最後一張點完之後再停留多久才 onDone。這是「點完
  // 之後的停頓」,不是從選單出現算起的總時長:總時長是
  // picks.length * PICK_INTERVAL_MS + confirmAfterMs。
  //
  // 省略時不自動送出,選單一直停在畫面上(點擊動畫仍然會演完),由呼叫端
  // 自己決定何時結束——捲動驅動的來源(demoScrollSource)推進到下一步時
  // 自己收起,不需要這個元件計時。
  confirmAfterMs?: number
  // stacked——候選卡片改成縱向上下堆疊,取代預設的橫向捲動列。2026-10
  // 新增(使用者明確要求「桌面版的詢問視窗候選改在右側、上下排列」):
  // 桌面版這個元件是渲染在右上角固定寬度的面板裡(見
  // home/plan-ai-sim/Content.tsx isDesktop 分支的完整說明),欄位不寬但可以
  // 往下延伸,縱向清單比橫向捲動更適合這個版面;手機版維持原本的橫向
  // 捲動(見 AskPage.module.css .directionScroller 的完整說明:跟
  // HorizontalPlanTimeline.tsx 的橫向卡片列是同一套滑動手感,不能悄悄
  // 改掉)。預設 false,呼叫端(home/plan-ai-sim/Content.tsx)依 isDesktop 決定
  // 要不要傳 true——只影響這個展示頁,不動正式 AskPage.tsx 的任何路徑。
  stacked?: boolean
}

interface CandidateDetail {
  name?: string
  photoUrl?: string
  attractionId?: string
  loading: boolean
}

export function ScriptedAskPage({
  dataSource,
  candidates,
  picks,
  reason,
  onDone,
  confirmAfterMs,
  stacked,
}: ScriptedAskPageProps) {
  // pickedCount——已經演出點擊了幾張。下方 selected 取 picks 的前
  // pickedCount 個,所以勾會一張一張出現,不是一次全亮——一次全亮看不出
  // 「點擊」這個動作發生過,像是畫面預設就長那樣。
  const [pickedCount, setPickedCount] = useState(0)
  // pickingId——這一刻正在播點擊特效的那一張。特效只在剛被點中的瞬間
  // 播一次,PICK_EFFECT_MS 後清掉,之後卡片回到單純的「已勾選」外觀;
  // 不清的話最後一張會一直停在特效結束的狀態上。
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [details, setDetails] = useState<Map<string, CandidateDetail>>(new Map())
  // confirmPressing——「確認選擇」正在演出被按下的那一刻。跟 pickingId
  // 同一個道理:只在那一瞬間為 true,特效播完就清掉。
  const [confirmPressing, setConfirmPressing] = useState(false)

  // 背景查詢候選的照片與正式名稱。邏輯對齊正式 AskPage 的同名 effect。
  useEffect(() => {
    if (candidates.length === 0) return
    let cancelled = false
    setDetails(new Map(candidates.map((c) => [c.placeId, { name: c.name, loading: true }])))
    for (const candidate of candidates) {
      dataSource
        .placeDetails(candidate.placeId)
        .then((result) => {
          if (cancelled) return
          setDetails((prev) => {
            const next = new Map(prev)
            next.set(candidate.placeId, {
              name: result.found && result.name ? result.name : candidate.name,
              photoUrl: result.found ? result.googlePhotoUrls?.[0] : undefined,
              attractionId: result.found ? result.attractionId : undefined,
              loading: false,
            })
            return next
          })
        })
        .catch(() => {
          // 查詢失敗維持候選本身帶來的暫時標題,只是沒有照片可用——
          // 理由同正式 AskPage 的同一處降級處理。
          if (cancelled) return
          setDetails((prev) => {
            const next = new Map(prev)
            next.set(candidate.placeId, { name: candidate.name, loading: false })
            return next
          })
        })
    }
    return () => {
      cancelled = true
    }
  }, [candidates, dataSource])

  // 演出時間線:依序點擊,最後(有 confirmAfterMs 時)送出。
  //
  // 整段排程在一個 effect 裡而不是多個——點擊之間、點擊到送出之間是
  // 一條有先後關係的時間線,拆開會讓「第 n 次點擊什麼時候發生」散落在
  // 多處,也更難保證卸載時全部清掉。用一個陣列收集所有計時器,卸載時
  // 一次清完:選單收起後不該再有計時器去改一個已卸載元件的 state,
  // 也不該對已經 resolve 的 Promise 再呼叫一次 onDone。
  //
  // 依賴刻意不列 picks/candidates/details/onDone 這些參照:呼叫端每次
  // 開詢問頁都是重新掛載一個新的實例(理由同正式 AskPage 的 effect),
  // 劇本內容在一次詢問的生命週期內不會變;把陣列或函式列進依賴,只會
  // 在父元件重算參照時把整條時間線重跑一遍。改用 picksKey 這個字串值
  // 當依賴——內容真的變了才重跑。
  const picksKey = picks.join(',')
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    picks.forEach((placeId, i) => {
      timers.push(
        setTimeout(
          () => {
            setPickedCount(i + 1)
            setPickingId(placeId)
            timers.push(setTimeout(() => setPickingId(null), PICK_EFFECT_MS))
          },
          // 第一張也要等一個間隔才點:選單剛出現的那一刻畫面還在轉場
          // (氣泡淡入、照片在載入),立刻勾第一張會看不出是點擊動作,
          // 像本來就勾著的。
          (i + 1) * PICK_INTERVAL_MS,
        ),
      )
    })
    if (confirmAfterMs != null) {
      // 送出不是直接呼叫 onDone——先演出「確認選擇」被按下(使用者明確
      // 指出確認按鈕不該消失:播放態要演的是完整的一個回合,AI 問 →
      // 使用者選 → 按下確認 → 行程排出來,少了最後那一下,看起來像是
      // 選完就自己跳走了)。按下特效播完才真正 onDone,收起詢問頁。
      const pressAt = picks.length * PICK_INTERVAL_MS + confirmAfterMs
      timers.push(
        setTimeout(() => {
          setConfirmPressing(true)
          timers.push(
            setTimeout(() => {
              onDone(picks.map((placeId) => ({ placeId, attractionId: details.get(placeId)?.attractionId })))
            }, CONFIRM_PRESS_MS),
          )
        }, pressAt),
      )
    }
    return () => {
      for (const t of timers) clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picksKey, confirmAfterMs])

  const selected = picks.slice(0, pickedCount)

  // 按鈕列照正式版一樣渲染(使用者明確指出確認按鈕不該消失):播放態演
  // 的是完整的一個回合,看得到「確認選擇(2)」這顆按鈕、看得到它被按下,
  // 使用者才看懂剛才那幾下點擊是在做什麼。先前這裡刻意不渲染按鈕列,
  // 理由是「沒有可按的東西,留著會以為畫面壞了」——那個判斷是錯的:
  // 演出少了結尾那一下,而且畫面跟正式版長得不一樣,違背「播放態演的
  // 要是真實畫面」這個前提。
  //
  // 卡片與按鈕都用 div 而非 button(正式版是 button):這裡沒有任何真的
  // 點擊行為,做成 button 會讓它們在鍵盤導覽裡可以 focus、在輔助技術上
  // 被報成可操作的控制項,而它們其實不是。文字內容本身是這段演出的實際
  // 內容,螢幕閱讀器讀得到才對,所以不加 aria-hidden。
  return (
    <div className={[styles.wrap, stacked ? styles.wrapStacked : ''].filter(Boolean).join(' ')}>
      <div className={[styles.bubble, stacked ? styles.bubbleStacked : ''].filter(Boolean).join(' ')}>
        <p className={styles.question}>{reason ?? '要安排這些地點嗎?'}</p>
        <div className={[styles.directionScroller, stacked ? styles.directionScrollerStacked : ''].filter(Boolean).join(' ')}>
          {candidates.map((candidate) => {
            const checked = selected.includes(candidate.placeId)
            const picking = pickingId === candidate.placeId
            const detail = details.get(candidate.placeId)
            return (
              <div
                key={candidate.placeId}
                className={[
                  styles.directionCard,
                  stacked ? styles.directionCardStacked : '',
                  checked ? styles.directionCardChecked : '',
                  picking ? styles.scriptedPicking : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {detail?.photoUrl ? (
                  <img
                    src={detail.photoUrl}
                    alt=""
                    className={[styles.directionPhoto, stacked ? styles.directionPhotoStacked : ''].filter(Boolean).join(' ')}
                  />
                ) : (
                  // stacked 模式的佔位縮圖——理由同 AskPage.tsx
                  // CandidatesPanel 同一處的完整說明,兩邊共用同一份
                  // AskPage.module.css,樣式邏輯保持一致。
                  stacked && (
                    <span className={styles.directionPhotoPlaceholder} aria-hidden="true">
                      <MapPin size={20} strokeWidth={2} />
                    </span>
                  )
                )}
                <span className={[styles.directionLabel, stacked ? styles.directionLabelStacked : ''].filter(Boolean).join(' ')}>
                  {detail?.loading ? '查詢中…' : (detail?.name ?? candidate.name ?? '未命名地點')}
                </span>
                {checked && <Check size={14} strokeWidth={3} className={styles.directionCheck} />}
                {/* 點擊漣漪——從卡片中心擴散出去的一圈,標示「這裡剛被
                    點了一下」。只在 picking 的那一刻渲染,動畫播完隨著
                    pickingId 清掉一起移除,不留在 DOM 裡。 */}
                {picking && <span className={styles.scriptedRipple} aria-hidden="true" />}
              </div>
            )
          })}
        </div>
        <div className={styles.actions}>
          <div className={styles.optionBtn}>不用了</div>
          <div
            className={[
              styles.optionBtn,
              styles.directionConfirm,
              confirmPressing ? styles.scriptedPressing : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {/* 計數跟著已演出的勾選張數走,不是 picks 全長——點擊演到
                第幾張,按鈕上的數字就是幾,兩邊同步才看得出因果。 */}
            {selected.length > 0 ? `確認選擇(${selected.length})` : '確認選擇'}
          </div>
        </div>
      </div>
    </div>
  )
}
