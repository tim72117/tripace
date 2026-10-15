import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { DESTINATION_REGIONS, DESTINATION_DIRECTIONS, type DestinationDirection } from './destinationPromptData'
import { useTypewriter } from './useTypewriter'
import styles from './DestinationPrompt.module.css'

// BUBBLE_IN_MS——問句氣泡的進場動畫時長(見 .module.css 的 .questionBubble
// bubbleIn 動畫),必須跟那份 CSS 動畫的秒數對應的毫秒數完全一致:使用者
// 明確要求「等畫面出現在打字」——氣泡本身要先完整彈出來,打字動畫才開始,
// 不是兩者同時發生。這個數字沒有別的來源可以推導,CSS 動畫秒數改了,這裡
// 要跟著手動同步。
const BUBBLE_IN_MS = 180

// DestinationPrompt——使用者進入 /app 時自動彈出的對話氣泡,主動詢問
// 「想去哪裡?」,依序問大地區 → 城市 → 要不要安排行程 → 玩法方向。
//
// 桌面版(variant="anchor",預設):掛在地圖右上角「規劃行程」對話按鈕正下方
// (見 DesktopLayout.tsx 掛載這個元件的完整說明)。
// 手機版(variant="phone"):沒有那顆右上角按鈕,改成撐滿寬度、貼在搜尋框
// 正下方(見 geo-planning/PlanPhoneView.tsx),使用者後來明確要求把這個氣泡
// 移植到手機版。兩個版型共用同一份流程與文案,只有定位/尖角不同。
//
// 檔名原本叫 DesktopDestinationPrompt.tsx,手機版也用之後去掉 Desktop 前綴。
//
// 放在 web/src/ 頂層(而非 geo-planning/ 或 components/)的理由:
//   - 不放 geo-planning/——那個資料夾的職責邊界是「地圖/地理規劃的資料
//     邏輯」(見該資料夾現有檔案:GeoCandidateSidebar/useGeoPlanningState/
//     ExploreMap 等,都直接處理地圖座標、POI、地理搜尋候選),這個元件
//     純粹是展示用的選單 UI,不碰任何地圖資料或座標,硬塞進去會混淆這個
//     資料夾原本清楚的邊界。
//   - 不放 components/——那裡收斂的是跨頁面共用的通用建材(Button/Banner/
//     FloatingPanel/PanelHead 等,任何頁面都可能用到),這個元件是這次
//     「首次進入 /app 的歡迎引導」這個單一功能專屬的 UI,只有
//     DesktopLayout.tsx 這一個呼叫端,不是通用建材。
//   - 不放 home/——那裡放的是行銷/城市介紹頁(HomePage/JiufenPage/
//     KyotoPage 等,見該資料夾說明),是公開、未登入也能看的內容,這個
//     元件是登入後 /app 主畫面的互動引導,性質完全不同。
//   - 放在頂層、取名 Desktop 開頭:比照 DesktopLayout.tsx/DesktopRail.tsx/
//     DesktopMain.tsx 等現有命名慣例——這些檔案都是「只在桌面版佈局裡
//     使用、職責單一、沒有獨立資料夾必要」的小型進版面元件,這個元件的
//     性質與它們一致。
//
// 兩層選單的 state 只在這個元件內部管理(selectedRegionId),不上提給
// 呼叫端——呼叫端(DesktopLayout.tsx)完全不需要知道使用者目前點到第幾層,
// 只在意「使用者最終選定了哪個城市」這一個時刻(見 onSelectCity),符合
// 使用者明確要求「這個新功能本身不自己做任何地區/城市邏輯判斷」——地區/
// 城市清單的選擇邏輯留在這裡,但「選完之後要做什麼」(組句子、呼叫
// sendPrompt、送進 onagent)完全交給呼叫端決定,這個元件不 import 任何
// onagent/TripPlanPage 相關的東西。
export interface DestinationPromptProps {
  // variant——定位版型,見檔頭說明。預設 'anchor'(桌面版)。
  variant?: 'anchor' | 'phone'
  // onSelectCity——使用者點選了某個城市子選項時觸發,只帶城市名稱這個
  // 純字串。2026-10 起選城市不再直接結束流程:呼叫端用它把地圖移到該城市,
  // 氣泡接著進入第三層詢問「需要安排行程嗎?」(見 onConfirmPlan)。
  onSelectCity: (city: string) => void
  // onConfirmPlan——第三層點「需要安排」後再於第四層確認玩法方向才觸發,帶
  // 使用者選定的城市與方向(可複選;空陣列代表「都可以」不限定),怎麼處理
  // (組成提示文字、送進 onagent 對話)完全交給呼叫端。點「先不用」不觸發任何
  // 回呼,直接走 onClose。
  onConfirmPlan: (city: string, directions: DestinationDirection[]) => void
  // onClose——氣泡右上角 X 按鈕觸發。使用者明確要求「只能靠明確的關閉
  // 按鈕關閉,點擊氣泡以外的地方不會關閉它」,所以這個元件刻意不處理
  // 任何「點擊外部」的偵測(沒有 backdrop、沒有監聽 document click)。
  onClose: () => void
}

export function DestinationPrompt({ variant = 'anchor', onSelectCity, onConfirmPlan, onClose }: DestinationPromptProps) {
  // selectedRegionId——null 表示目前在第一層(大地區清單);有值表示已經
  // 點過某個地區,切到第二層顯示該地區的城市清單。
  //
  // 不需要「返回上一層」的額外狀態機制:使用者明確要求的流程只有「選地區
  // → 選城市 → 確認要不要安排行程」這個單向路徑,沒有要求要能從城市清單返回地區
  // 清單。若日後要加返回按鈕,再補一個 setSelectedRegionId(null) 的入口
  // 即可,不需要現在預先設計。
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)

  // selectedCity——null 表示還沒選城市;有值表示已經選定城市,切到第三層
  // 詢問「需要安排行程嗎?」。三層是單向流程(地區 → 城市 → 確認),同樣
  // 沒有返回機制,理由同上方 selectedRegionId 的說明。
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  // wantsPlan——第三層點了「需要安排」,切到第四層選玩法方向(使用者明確要求
  // 「顯示附近獨特的旅遊項目,像是古蹟、美食、展館、戶外活動,讓使用者選決定
  // 方向」)。同樣是單向流程,沒有返回。
  const [wantsPlan, setWantsPlan] = useState(false)
  // selectedDirectionIds——第四層已勾選的玩法方向(使用者明確要求「類型可以
  // 複選」)。點照片卡是切換勾選,不會立刻送出;要按「開始安排」才確認,
  // 「都可以」則是不限定、直接確認。
  const [selectedDirectionIds, setSelectedDirectionIds] = useState<string[]>([])
  const toggleDirection = (id: string) => {
    setSelectedDirectionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // 預載玩法方向的代表照片:使用者選定城市(進入第三層)時就先把照片載進
  // 瀏覽器快取,等點「需要安排」進第四層、選項氣泡出現時照片已經在,不會
  // 看到卡片先空白、照片再逐張跳出來。圖片是打包進專案的小圖,預載成本很低。
  useEffect(() => {
    if (selectedCity == null) return
    for (const direction of DESTINATION_DIRECTIONS) {
      if (direction.photo) new Image().src = direction.photo
    }
  }, [selectedCity])

  const selectedRegion = selectedRegionId != null
    ? DESTINATION_REGIONS.find((r) => r.id === selectedRegionId) ?? null
    : null

  // question——目前這一層要顯示的文案,兩層共用同一個 useTypewriter
  // 呼叫(而不是分別在兩個 JSX 分支各自呼叫一次):text 變動時
  // useTypewriter 會自動從頭重新打字(見該 hook 的完整說明),切換到
  // 第二層時 question 文字跟著變成城市清單的提示句,視覺上就是「换一句
  // 重新打一次」,不需要兩份重複的 hook 呼叫與 state。
  const question = selectedCity != null && wantsPlan
    ? `${selectedCity}想偏重哪些玩法?(可複選)`
    : selectedCity != null
    ? `要幫你安排${selectedCity}的行程嗎?`
    : selectedRegion == null
    ? '想去哪裡?'
    // 第二層標題沿用地區名稱,讓使用者清楚知道目前正在看哪個地區底下的
    // 城市,不需要額外的「返回」按鈕也能靠這行文字確認自己選對了地區
    // (使用者沒有要求返回功能,見上方 state 的完整說明)。
    : `${selectedRegion.label}——想去哪個城市?`

  // bubbleReady——問句氣泡的進場動畫(.questionBubble 的 bubbleIn)先跑
  // 完,才允許 useTypewriter 開始打字(使用者明確要求「等畫面出現在
  // 打字」,不是氣泡彈出跟打字動畫同時發生)。切換地區(question 變動)
  // 時同樣要重新等一輪——第二層的問句是另一次「氣泡重新彈出」的語意,
  // 見下方 useEffect 依賴 question 重新倒數計時的完整說明。
  const [bubbleReady, setBubbleReady] = useState(false)
  useEffect(() => {
    setBubbleReady(false)
    const timer = window.setTimeout(() => setBubbleReady(true), BUBBLE_IN_MS)
    return () => window.clearTimeout(timer)
  }, [question])

  // useTypewriter——使用者明確要求「用打字效果」:文案逐字顯示,只有在
  // bubbleReady 為 true(氣泡彈出動畫已跑完)才餵真正的文字進去,在那之前
  // 傳空字串讓 hook 保持「尚未開始打字」的狀態,不會在氣泡還在彈跳時就
  // 搶先顯示文字。下面的膠囊選項氣泡則等文字完全打完(typingDone)才出現
  // (使用者明確要求「先顯示你去哪裡,下面再出現可選的膠囊」)。
  const { displayedText, done: typingDone } = useTypewriter(bubbleReady ? question : '')

  return (
    // wrap——取代原本單一個 .bubble,改成兩個各自獨立的氣泡卡片堆疊
    // (使用者明確要求「選項跟問句的泡泡分開」),這個外層容器只負責把
    // 兩個氣泡用小間距(見 .module.css 的 .wrap gap)疊在一起,本身沒有
    // 背景/邊框。
    <div className={variant === 'phone' ? `${styles.wrap} ${styles.wrapPhone}` : styles.wrap} role="dialog" aria-label="想去哪裡?">
      <div className={styles.questionBubble}>
        {/* tail——指向上方「規劃行程」小匡的尖角,讓這個氣泡視覺上明確是
            從那張小匡延伸出來的提示,不是一個獨立飄浮的卡片。見
            .module.css 的 .tail 完整說明。只掛在問句氣泡上——選項氣泡
            是從問句氣泡延伸下來的,不需要再指向規劃小匡。 */}
        {variant === 'anchor' && <div className={styles.tail} />}
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={14} strokeWidth={2} />
        </button>
        {/* aria-live——螢幕閱讀器使用者不需要逐字聽完整個打字動畫過程,
            只要在文字打完的那一刻念出最終整句即可;displayedText 中途的
            每個字元變化不觸發額外朗讀(polite + 用完整句子才更新,screen
            reader 實務上只會在內容穩定後播報)。 */}
        <p className={styles.question} aria-live="polite">{displayedText}</p>
      </div>
      {/* 膠囊選項——獨立的第二個氣泡卡片,打字動畫完全跑完(typingDone)
          才渲染,呼應上面 useTypewriter 呼叫處的完整說明。中途切換地區時
          typingDone 會先變回 false(question 變了,bubbleReady 也重新倒數
          一輪),這個氣泡會先消失、等新的一句打完才重新出現,不會出現
          「舊選項還留著,新文字已經在打字」的不一致畫面。 */}
      {typingDone && (
        <div className={styles.optionBubble}>
          {selectedCity != null && wantsPlan ? (
            <div className={styles.directionGrid}>
              {/* 照片卡片(使用者明確要求「每一種類型都要放該類型的熱門相片」、
                  「類型可以複選」):點一下切換勾選,選中顯示藍框與勾,
                  aria-pressed 讓螢幕閱讀器知道目前是否選取。照片是裝飾性的
                  (按鈕文字已經說明類型),alt 留空。 */}
              {DESTINATION_DIRECTIONS.map((direction) => {
                const checked = selectedDirectionIds.includes(direction.id)
                return (
                  <button
                    key={direction.id}
                    type="button"
                    aria-pressed={checked}
                    className={checked ? `${styles.directionCard} ${styles.directionCardChecked}` : styles.directionCard}
                    onClick={() => toggleDirection(direction.id)}
                  >
                    <img src={direction.photo} alt="" className={styles.directionPhoto} />
                    <span className={styles.directionLabel}>{direction.label}</span>
                    {checked && <Check size={14} strokeWidth={3} className={styles.directionCheck} />}
                  </button>
                )
              })}
              {/* 「都可以」:不限定方向,直接確認(空陣列)。「開始安排」:確認已勾選
                  的方向,沒勾任何一個時停用——沒有偏好的人請按「都可以」,不需要
                  允許「什麼都沒選卻按開始」這種語意不清的狀態。 */}
              <button
                type="button"
                className={styles.optionBtn}
                onClick={() => onConfirmPlan(selectedCity, [])}
              >
                都可以
              </button>
              <button
                type="button"
                className={`${styles.optionBtn} ${styles.directionConfirm}`}
                disabled={selectedDirectionIds.length === 0}
                onClick={() =>
                  onConfirmPlan(
                    selectedCity,
                    DESTINATION_DIRECTIONS.filter((d) => selectedDirectionIds.includes(d.id)),
                  )
                }
              >
                {selectedDirectionIds.length > 0 ? `開始安排(${selectedDirectionIds.length})` : '開始安排'}
              </button>
            </div>
          ) : selectedCity != null ? (
            <div className={styles.optionList}>
              <button type="button" className={styles.optionBtn} onClick={() => setWantsPlan(true)}>
                需要安排
              </button>
              <button type="button" className={styles.optionBtn} onClick={onClose}>
                先不用
              </button>
            </div>
          ) : selectedRegion == null ? (
            <div className={styles.optionList}>
              {DESTINATION_REGIONS.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  className={styles.optionBtn}
                  onClick={() => setSelectedRegionId(region.id)}
                >
                  {region.label}
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.optionList}>
              {selectedRegion.cities.map((city) => (
                <button
                  key={city}
                  type="button"
                  className={styles.optionBtn}
                  onClick={() => {
                    setSelectedCity(city)
                    onSelectCity(city)
                  }}
                >
                  {city}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
