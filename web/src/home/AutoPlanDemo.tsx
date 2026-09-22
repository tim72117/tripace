import { useEffect, useState, type CSSProperties } from 'react';
import styles from './AutoPlanDemo.module.css';

// AutoPlanDemo:「自動編排行程」功能卡片內嵌的假聊天+時間軸示範,見
// ProductPage.tsx 掛載處的完整說明。
//
// 2026-09 沿革:原本「自然語言查詢」卡片改主題為「自動編排行程」,示意
// 動畫從「打字→找地點結果清單」換成「打字→系統自動生成時間軸行程」——
// 前半段聊天輸入框仍沿用同一套視覺(打字動畫+送出鈕+AI 回覆行,見
// NaturalQueryDemo.tsx 的完整說明,數值照抄自
// web/src/planning-demo/AIPlanTimelinePage.module.css 的 .inputWrap/
// .input/.sendBtn/.aiLine/.aiLineIcon),後半段結果呈現方式整個換掉:
// 不再顯示「符合條件的結果清單卡」(那是「查詢找地點」的語意),改成
// 顯示「系統自動排出的一份時間軸行程」(呼應「自動編排行程」這個新主題
// ——重點是「系統自動幫你把候選景點排成一份完整行程」,不是「幫你找
// 地點」)。
//
// 時間軸呈現方式參考 AIPlanTimelinePage.tsx/.module.css 原本「時間軸上
// 依序長出每個行程站點」的視覺語言(骨架卡呼吸點提示生成中、軸線隨站點
// 增加往下延伸、每個站點卡片逐一掛載淡入),但那個頁面是滿版獨立頁面,
// 版面複雜度(右上角小地圖、對話框測試按鈕、骨架卡 shimmer、進場動畫
// 矩陣)遠超過一張功能卡片能承載的寬度與份量,故大幅簡化:拿掉地圖與
// 對話框測試功能,只留「一條垂直時間軸主軸線+依序浮現的站點卡(時間+
// 地點名稱+一句話)」這個最核心、也最能表達「自動排出順序」這個賣點的
// 結構,也不像 AIPlanTimelinePage 那樣做骨架卡/shimmer(那套是給「AI
// 還在查詢真實地點資料」這種需要更長等待感的情境用的,這裡是快速循環
// 的示意動畫,直接讓站點卡逐一淡入生長即可,不需要額外的骨架屏中繼
// 狀態)。也可參考本頁已完成的 TimelineDemo.tsx(時間軸排程卡片的示意
// 動畫)裡「時間軸卡」的視覺結構(.timeline/.timelineHeader/.timelineSlot/
// .timelineTime/.timelineCard/.timelineCardFilled/.timelineCardLabel)——
// 但這裡不含地圖,純粹是「打字→送出→思考中→時間軸站點依序生成」的
// 垂直流程,兩者是各自獨立的視覺(TimelineDemo 疊在地圖上、這裡是純
// 垂直捲軸式時間軸),不共用元件或 CSS。
//
// 跟 ThemePointDemo/TimelineDemo/NaturalQueryDemo 一樣掛 app-theme-root
// class(+ data-theme 屬性,接收 dark prop)——理由見 ThemePointDemo.tsx
// 開頭「app-theme-root class」段落的完整說明,這裡不重複展開。

// QUERY_TEXT:示範查詢句——刻意寫成「天數+主題+地點」的完整需求描述
// (兩天一夜、親子、台南),呼應「自動編排行程」的賣點:使用者只需要
// 描述整體需求,不用自己一步步排時段,系統會自動把候選景點排成一份
// 完整的每日行程。
const QUERY_TEXT = '幫我排兩天一夜的台南親子行程';

// PLAN_STOPS:自動生成的假行程站點——2026-09 使用者要求「自動編排三個
// 站就好」,從原本 4 筆縮減成 3 筆(上午/中午/傍晚),份量對一張功能卡片
// 而言更精簡,不需要塞滿一整天四個時段才能表達「自動排出順序」這個
// 賣點。呼應 QUERY_TEXT 的「親子」主題(景點類型偏向親子友善),每筆
// 一句話點出這個時段安排的理由,讓「一句需求→一份完整行程」的對應
// 關係看起來合理,而非隨機湊幾個地點。時間安排大致是一天的行程節奏
// (09:00 出發、傍晚收尾),不含日期切換(2 天只示範 Day 1 即可,這裡
// 是快速循環的示意動畫,不需要真的排出兩天份內容)。
const PLAN_STOPS = [
  { id: 'anping-fort', time: '09:00', name: '安平古堡', note: '早上人潮較少，城堡頂樓視野適合帶小孩眺望港口。' },
  { id: 'anping-tree-house', time: '10:30', name: '安平樹屋', note: '樹根與老屋交纏的步道，小孩喜歡的探險感十足。' },
  { id: 'anping-harbor', time: '17:00', name: '安平港濱歷史公園', note: '傍晚海風舒適，草地遊具區是收尾行程的好選擇。' },
] as const;

// 整個循環拆成五段,模擬「打字→送出→思考中→時間軸站點依序長出→看完
// 收回重播」的真實體驗節奏(比照 ThemePointDemo/TimelineDemo/
// NaturalQueryDemo 的 Phase 狀態機設計慣例——用具名階段而非一堆各自
// 獨立的布林值,因為這幾個階段是嚴格先後順序、互斥的,字串聯合型別比
// 布林值排列組合更準確地限制住合法狀態):
//   typing    輸入框逐字打出 QUERY_TEXT,模擬使用者正在描述需求,尚未
//             送出。
//   thinking  文字打完、送出鈕已可點——模擬「送出後系統正在自動安排
//             行程」的短暫停頓(不是技術上真的有任何非同步請求,純粹是
//             刻意留白的動畫節奏設計,同 ThemePointDemo 的 LOAD_DELAY_MS
//             /NaturalQueryDemo 的 THINKING_MS)。
//   generating 時間軸站點依序一個一個長出來(同 TimelineDemo 的
//             flownCount/NaturalQueryDemo 的 revealedCount 逐一遞增手法)
//             ——「自動編排」的重點正是「系統依序排出順序」,逐一生長
//             比一次全部出現更能傳達「正在自動排」這個過程本身。
//   done      整份行程時間軸都已完整顯示,停留一段時間讓使用者看清楚
//             「一句需求→一份完整行程」的最終結果。
//   done(重置) 輸入框文字清空、時間軸收回,重新開始循環。
type Phase = 'typing' | 'thinking' | 'generating' | 'done'

// TYPE_STEP_MS:每個字元打出的間隔——同 NaturalQueryDemo 的 TYPE_STEP_MS,
// 模擬真人打字速度(QUERY_TEXT 約 17 字,乘以這個間隔約 1.4s,是一段
// 能看清楚文字內容但不會枯燥的長度)。
const TYPE_STEP_MS = 85;
// THINKING_MS:文字打完到時間軸開始生成前的停頓——比 NaturalQueryDemo 的
// THINKING_MS(650ms)略長,因為「自動編排一整份行程」比「查詢找地點」
// 語意上是更重的運算(要決定順序、時段、動線),停頓稍微久一點更符合
// 這個語意(但不到會讓人覺得卡住的程度)。
const THINKING_MS = 750;
// STOP_STEP_MS:每個站點依序長出時間軸的間隔——比 TimelineDemo 的
// FLY_STEP_MS(420ms)/NaturalQueryDemo 的 RESULT_STEP_MS(360ms)稍長,
// 這裡站點數量較多(4 筆)且每筆都要讓人看清楚「時間+地點+一句話」,
// 稍微放慢生長節奏,讓「依序排出順序」的過程感更明顯。
const STOP_STEP_MS = 450;
const DONE_MS = 2800;

export function AutoPlanDemo({ dark }: { dark: boolean }) {
  const [phase, setPhase] = useState<Phase>('typing');
  // typedLength:typing 階段目前已經打出的字元數(0~QUERY_TEXT.length),
  // 逐一遞增——理由同 NaturalQueryDemo 的 typedLength,用單一數字搭配
  // QUERY_TEXT.slice(0, typedLength) 取代另外維護一份字串 state。
  const [typedLength, setTypedLength] = useState(0);
  // generatedCount:generating 階段目前已經長出的站點數量(0~PLAN_STOPS.length)
  // ——同 TimelineDemo 的 flownCount/NaturalQueryDemo 的 revealedCount,
  // 逐一遞增讓站點卡一筆接一筆出現在時間軸上。
  const [generatedCount, setGeneratedCount] = useState(0);

  // typing 階段:每隔 TYPE_STEP_MS 多打出一個字元,打滿後轉入 thinking
  // 階段——用 typedLength 本身當依賴,依目前進度決定下一步(同
  // ThemePointDemo 的 PHASE_DELAYS 遞迴排程手法,而非固定 setInterval,
  // 理由是不同階段/步驟間隔可能不等長,這裡雖然每個字元間隔相同,但用
  // 同一種手法保留未來調整彈性、也跟既有元件寫法一致)。
  useEffect(() => {
    if (phase !== 'typing') return
    if (typedLength >= QUERY_TEXT.length) {
      const t = setTimeout(() => setPhase('thinking'), TYPE_STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setTypedLength((n) => n + 1), TYPE_STEP_MS)
    return () => clearTimeout(t)
  }, [phase, typedLength])

  useEffect(() => {
    if (phase === 'thinking') {
      const t = setTimeout(() => setPhase('generating'), THINKING_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'done') {
      const t = setTimeout(() => {
        setPhase('typing')
        setTypedLength(0)
        setGeneratedCount(0)
      }, DONE_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  // generating 階段:每隔 STOP_STEP_MS 讓下一個站點長出時間軸,全部長完
  // 後轉入 done 階段——寫法同上面 typing 階段的遞迴排程。
  useEffect(() => {
    if (phase !== 'generating') return
    if (generatedCount >= PLAN_STOPS.length) {
      const t = setTimeout(() => setPhase('done'), STOP_STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setGeneratedCount((c) => c + 1), STOP_STEP_MS)
    return () => clearTimeout(t)
  }, [phase, generatedCount])

  const submitted = phase !== 'typing';
  const thinking = phase === 'thinking';
  const generating = phase === 'generating';
  const done = phase === 'done';

  return (
    <div className={`${styles.demo} app-theme-root`} data-theme={dark ? 'dark' : 'light'}>
      {/* 聊天輸入框——數值照抄 AIPlanTimelinePage.module.css 的
          .inputWrap/.input/.sendBtn,跟 NaturalQueryDemo 完全同一套視覺
          規格(見該檔案的完整說明,這裡不重複展開)。文字用
          QUERY_TEXT.slice(0, typedLength) 逐字顯示,搭配 .caret 一根
          閃爍的游標;submitted 為 true 後(thinking 階段起)游標停止
          閃爍、send 鈕從灰階「未輸入」樣式轉為 --color-dark 實色「可
          送出」樣式。 */}
      <div className={styles.chatInputWrap}>
        <span className={styles.chatInput}>
          {QUERY_TEXT.slice(0, typedLength)}
          {!submitted && <span className={styles.caret} />}
        </span>
        <div className={`${styles.chatSendBtn} ${submitted ? styles.chatSendBtnActive : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </div>
      </div>

      {/* AI 回覆行——數值照抄 .aiLine/.aiLineIcon,同 NaturalQueryDemo。
          thinking 階段顯示「思考中」三顆呼吸點,generating/done 階段顯示
          「已為你排好 N 個行程站點」,呼應「自動編排行程」的完成文案
          (跟 NaturalQueryDemo 的「為你找到 N 個符合的地點」語意不同,
          這裡強調「排好」而非「找到」)。 */}
      <div className={styles.aiLine}>
        <span className={styles.aiLineIcon}>✦</span>
        {thinking ? (
          <span className={styles.thinkingDots}>
            自動安排中
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </span>
        ) : generating || done ? (
          <span>已為你排好 {PLAN_STOPS.length} 個行程站點</span>
        ) : (
          <span>想去哪裡玩？直接打一句話告訴我，交給我排行程</span>
        )}
      </div>

      {/* 時間軸——取代 NaturalQueryDemo 原本的「結果清單卡」,改成「一條
          垂直主軸線+依序長出的站點卡」,呼應「自動編排行程」的核心賣點
          (見檔頭完整說明)。.axisLine 是貫穿已生成站點範圍的縱向直線
          (用單一 absolute 定位的長條模擬 AIPlanTimelinePage 的
          axisLineAbove/axisLineBelow 軸線,這裡簡化成一條連續的線,不像
          正式頁面那樣逐段拼接,因為這裡站點之間沒有「移除/插入」這種
          需要斷開重接的情境)。
          2026-09:使用者要求「時間線不要一次就出現,而是隨編排出現」
          ——原本軸線是固定貫穿整個 .timeline 高度的做法(理由是「拿掉
          軸線本身也要動畫生長這層複雜度」),但使用者明確要這條線本身
          也要跟著站點依序生成而延伸,故改成用 CSS 自訂屬性
          --axis-progress 傳遞目前進度比例(generatedCount /
          PLAN_STOPS.length,done 階段視為 1 即滿格),軸線高度用
          calc(百分比)動態計算(見 AutoPlanDemo.module.css 的 .axisLine
          完整說明),搭配 transition 讓軸線跟著站點卡一起平滑往下長,而
          非一開始就整條畫滿。全部站點一開始就都在 DOM 裡(不是等生成
          才掛載),靠 CSS class(.stopRevealed)切換 opacity/transform
          做逐一淡入,而非用條件渲染——理由同 ThemePointDemo 的
          .demoPoiRevealed 完整說明(條件渲染會讓每次浮現都是全新掛載的
          DOM 節點,CSS transition 不會播放)。 */}
      <div className={styles.timeline}>
        <div
          className={styles.axisLine}
          style={{ '--axis-progress': done ? 1 : generatedCount / PLAN_STOPS.length } as CSSProperties}
        />
        {PLAN_STOPS.map((stop, index) => {
          const revealed = index < generatedCount || done;
          return (
            <div
              key={stop.id}
              className={`${styles.stopRow} ${revealed ? styles.stopRowRevealed : ''}`}
            >
              <div className={styles.stopDot} />
              <div className={styles.stopBody}>
                <div className={styles.stopTime}>{stop.time}</div>
                <div className={styles.stopName}>{stop.name}</div>
                <div className={styles.stopNote}>{stop.note}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}
