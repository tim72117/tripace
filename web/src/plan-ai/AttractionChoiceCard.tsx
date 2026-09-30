import styles from './AIPlanTimelinePage.module.css'

// AttractionChoiceCard — 試做:當同一類地點（例如「餐廳」）有多個候選
// 時，不讓 LLM 自己挑一個直接加入行程，而是在時間軸上顯示一張選擇卡，
// 列出全部候選讓使用者親自點選要加入哪一個。
//
// 這一版只做「介面本身」(2026-09 使用者明確要求「先試做介面」)：
// - 資料來源是外部傳入的固定候選陣列(呼叫端目前餵假資料，之後才接
//   真正的 LLM 工具呼叫——見下方 AttractionChoice 型別的完整說明)。
// - 選定後呼叫 onSelect(choice)，實際「加入行程」這個動作(呼叫
//   insertAttractionAfter)交給呼叫端決定，這個元件本身不碰
//   PlanTimeline/insertAttractionAfter，維持單一職責:只負責「顯示
//   候選、回報使用者選了哪一個」。
// - 視覺沿用 .stopCard 既有卡片語言(縮圖圓形/名稱/簡介/標籤)，讓使用者
//   一眼就能認出「這也是一張地點卡片」，只是這次要點的是其中一張、
//   不是整個區塊本身可點——故沒有沿用 .stopCard 的 role="button" 包法，
//   改成每張候選各自是獨立的 <button>。
//
// 之後若要接上真正的工具呼叫，設想的資料流是：LLM 呼叫一個新工具
// (例如 present_choices)、帶入候選陣列，前端收到後把這批候選存進
// 一個獨立的「待選中」state(不進 PlanTimeline，選定前這些候選都還不是
// 時間軸節點)，渲染這張卡片；使用者點選後才呼叫
// insertAttractionAfter(選定候選的 placeId, anchorId, time)，把回傳的
// 新節點 id 回報給 LLM(工具呼叫的回傳值)，讓對話可以接續下去。這一版
// 先不做工具串接，choices/onSelect 只用來驗證卡片本身的視覺與互動。

export interface AttractionChoice {
  placeId: string
  name: string
  desc?: string
  thumbIcon?: string
  thumbBg?: string
  tags?: string[]
}

export function AttractionChoiceCard({
  prompt,
  choices,
  onSelect,
}: {
  // prompt:這張選擇卡上方的引導文字，例如「附近有幾間餐廳，選一間加入行程：」。
  prompt: string
  choices: AttractionChoice[]
  onSelect: (choice: AttractionChoice) => void
}) {
  return (
    <div className={styles.choiceCard}>
      <div className={styles.choicePrompt}>{prompt}</div>
      <div className={styles.choiceList}>
        {choices.map((choice) => (
          <button
            key={choice.placeId}
            type="button"
            className={styles.choiceItem}
            onClick={() => onSelect(choice)}
          >
            <div className={styles.stopThumb} style={{ background: choice.thumbBg }}>
              {choice.thumbIcon}
            </div>
            <div className={styles.stopBody}>
              <div className={styles.stopName}>{choice.name}</div>
              {choice.desc && <div className={styles.stopDesc}>{choice.desc}</div>}
              {choice.tags && choice.tags.length > 0 && (
                <div className={styles.stopTags}>
                  {choice.tags.map((tag) => (
                    <span key={tag} className={styles.stopTag}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
