import type { IdeaDoc } from '../../types'

export const DESIGN_UX_02: IdeaDoc = {
  id: 'design-ux-02',
  group: 'design-discussion',
  order: 102,
  title: '對話式 AI 操作流程',
  summary:
    '盤點既有的 assist 回饋鏈,並補齊進行中(新增/刪除可指認)、完成後(操作回執卡)、反悔(分層 undo)三段體驗,加上 AI 追問的呈現強化與時序總覽。',
  sections: [
    {
      heading: '3.1 現況(基礎已具備)',
      paragraphs: ['一句話進 `assist` 後的既有回饋鏈:'],
      bullets: [
        '送出即插入海浪佔位泡泡(`WaveLoader`)。',
        '`task_plan` 建立多步計畫時,WS `task_created` 在對應日期插入逐字波浪佔位卡(`TaskPlaceholderCard`),`task_entry_ready` 換成正式卡。',
        '`entry_update` 前 WS `entry_updating` 讓該卡亮「更新中」光影(最短 800ms),`entries_updated` 後重抓解除。',
        '`ask_user`(目前僅日期)/`ask_choice` 由 WS 推事件開底部面板。',
        '`recorded` 分支輪詢 `fetchEntries` 直到筆數變多(上限 20 秒)。',
      ],
    },
    {
      heading: '3.2(a) 進行中——讓「新增」與「刪除」也可指認',
      paragraphs: [
        '現況只有 update 有逐筆光影、只有走 task_plan 的新增有佔位卡。補齊:',
      ],
      bullets: [
        '單獨新增一筆(沒帶 taskID)完成時,前端以「重抓前後 entries 的差集」找出新卡,對它播放一次進場動畫(淡入 + 一輪光暈,約 1.2s),讓視線被帶到新增的位置;若新卡在視窗外,時間軸自動平滑捲動到它。零後端改動。',
        '現況補充:AI 對話新增現在走 `trip_entry_add`,寫入的是裝置端旅程清單而非 Postgres entry(見 6.2);此處「差集找新卡」的動畫設計對「時間軸的 entry」仍然適用,只是觸發來源已不是 `entry_add`。',
        '刪除完成時,同樣以差集找出消失的卡,在原位塌陷(高度收合 200ms)並暫留一條 5 秒的「已刪除『○○』 [復原]」細條。零後端改動。',
        '地圖已展開時,被操作條目的 marker 同步呼吸閃爍(同 `.updating` 的光影節奏),操作完成後 marker 定格——「AI 正在動哪個地點」在地圖上也看得到。',
      ],
    },
    {
      heading: '3.2(b) 完成後——操作回執卡(對話浮層內)',
      paragraphs: [
        '`assist` 回覆後,在對話浮層插入一張結構化回執(取代單純讓卡片自己出現)。回執範例:「✓ 已更新「晴空塔」/ 時間 13:00 → 15:00 / [檢視] [復原]」。',
      ],
      bullets: [
        '內容:動作(新增 N 筆/更新/刪除)+ 變更欄位的 before → after 摘要。update 的 before 值由前端在收到 `entry_updating` 時就地快照(該 entryID 當下的欄位值),不需後端提供 diff。',
        '[檢視] 捲動到該卡並展開;[復原] 見 3.2(c)。',
        '回執與現有訊息泡泡同屬 `chat-overlay`,點時間軸空白處一併淡出(現有行為),但 undo 入口不因此消失——見下。',
      ],
    },
    {
      heading: '3.2(c) 反悔——undo 的分層設計',
      paragraphs: ['後端沒有版本歷史,undo 只能靠前端反向操作。誠實拆解可行性:'],
      table: {
        headers: ['原操作', '反向操作', '現有端點夠嗎'],
        rows: [
          ['entry_update', 'PATCH 回 before 值', '✅ `PATCH /v1/entries/{id}` 已有'],
          [
            '新增一筆',
            '刪除該 entryID',
            '✅ `DELETE /v1/trips/{id}/entries/{entryID}` 已有(`handleDeleteTripEntry`;前端封裝 `api.ts` 的 `deleteTripEntry`)。路徑形狀是 trip-scoped 而非本文原先提議的 entry-scoped,呼叫時需一併帶 tripID。現況補充:這個端點操作的是 Postgres entry;AI 對話新增現在走 `trip_entry_add`,寫入裝置端旅程清單(見 6.2),undo 若要適用於 AI 新增的項目,需走裝置端清單自己的刪除(`trip_entry_delete`,目前不在 assistant 白名單內),而非這支 REST 端點',
          ],
          [
            '刪除一筆',
            '以快照重建',
            '✅ `POST /v1/trips/{id}/entries` 已有(`handleCreateTripEntry`;前端封裝 `api.ts` 的 `createTripEntry`)。同時就是手動新增的入口,見手動編輯流程一章',
          ],
        ],
      },
      bullets: [
        '前端維護 per-trip 的 session undo stack(記憶體,重整即失,誠實標示「復原僅限本次瀏覽期間」);composer 上方浮一顆小小的「↩」膠囊,存在可復原操作時才顯示。',
        '已知限制:`PATCH` 目前「空字串 = 不改」,若 before 值本來是空(例如原本沒有 end),undo 無法把欄位改回空。完整的 undo 依賴 Phase 2 的 API 語意修正(建議:JSON 缺鍵 = 不改、`null` = 清空),在此之前回執卡對這類欄位標註「此欄位無法自動復原」。',
        'fallback:回執卡的復原失敗時,提示可改用對話(「跟 AI 說:把剛剛的變更改回來」)——agent 有對話歷史與 `entry_query`,通常能復原,但不保證精確,故只作為輔助路徑而非主設計。',
      ],
    },
    {
      heading: '3.3 AI 追問(ask_user / ask_choice)的呈現強化',
      paragraphs: ['現況兩個底部面板已可用,補三件事:'],
      bullets: [
        '關閉 ≠ 取消消失:點背景關閉面板後,追問收合成 composer 上方的「待回覆 chip」(`📌 待補:希爾頓退房日`),點 chip 重開面板;回覆送出後 chip 消失。解決「誤觸背景、追問就再也找不回」——現況 agent 已結束該輪,資訊永遠缺著。',
        '帶地理脈絡的選擇:`ask_choice` 的選項若對應地點(例如「兩間旅館選一間」),面板內嵌一張迷你地圖同時標出選項位置與當日行程動線,讓「選哪個順路」變成看得見的判斷(選項需帶 lat/lng,需後端在 `ask_choice` options 增列選填座標欄位,小改)。',
        '`askType` 目前僅 `date`;隨手動編輯元件的建立,`time`、`place` 兩型可直接復用同一批輸入元件(Phase 2)。',
      ],
    },
    {
      heading: '3.4 時序總覽(一句話 → 時間軸更新)',
      paragraphs: ['以使用者送出「把晴空塔改到三點」為例:'],
      bullets: [
        '使用者送出 → 泡泡佔位(海浪)[即時]。',
        'WS `entry_updating(ent_xxx)` [約 1 秒] → 卡片光影 + 地圖 marker 呼吸 + 快照 before。',
        'WS `entries_updated` → 重抓 → 光影解除 [約 2–5 秒]。',
        'assist HTTP 回覆 → 回執卡(13:00→15:00 [復原])。',
        '間隙標籤與日摘要隨新時間重算 [即時,前端]。',
      ],
      note: '改良建議(零後端):`recorded` 分支目前用 1 秒輪詢等新條目,但後端本來就會廣播 `entries_updated`——前端改成「以 WS 事件為主、輪詢僅作 20 秒保底」,平均等待可縮短一半以上。',
    },
  ],
  tags: ['行程 UX', 'AI 對話', 'undo', '回執卡'],
  source: ['docs/itinerary-ux-design.md'],
}
