import type { IdeaDoc } from '../../types'

export const DESIGN_UX_03: IdeaDoc = {
  id: 'design-ux-03',
  group: 'design-discussion',
  order: 103,
  title: '手動編輯流程',
  summary:
    '升級編輯表單、補上新增入口、設計由輕到重的時間/順序調整手勢,並讓手動與 AI 操作共用同一套視覺語言。',
  sections: [
    {
      heading: '4.1 編輯一筆(現有 EditEntrySheet 的延伸)',
      paragraphs: [
        '入口不變:點卡片展開 →「編輯」→ 底部表單(`edit-entry-sheet`)。表單升級後的欄位:',
      ],
      bullets: [
        '標題。',
        '開始:日期 + 時刻,時刻欄附快速 chips:上午 9:00 / 午 12:00 / 下午 14:00 / 晚 18:00。',
        '結束:日期 + 時刻。',
        '類型:kind(flight/stay/car/activity/food/transport/other)。',
        '地點:文字欄,下方附 120px 靜態小地圖;地點有座標時顯示,改地點後顯示「儲存後將重新定位」。',
        '備註。',
        '底部按鈕:[🗑 刪除] 與 [取消][儲存]。',
      ],
    },
    {
      heading: '4.1 編輯表單的後端現況與限制',
      bullets: [
        '地點欄與座標:誠實現況——`PATCH` 改了 location 後座標不會更新(`handleUpdateEntry` 以 `tripsvc.New(s.store, nil)` 建 service,geo 為 nil)。需後端小改:PATCH 帶 location 且值有變時,走與 `tripsvc.Record` 相同的非同步 geocode 補 lat/lng。這是地圖正確性的必要條件,列 Phase 1。',
        '同步廣播:原先的現況是 `handleUpdateEntry` 完成後沒有廣播 `entries_updated`,現已修復——`server/internal/api/api.go` 的 `handleUpdateEntry` 最後已呼叫 `s.hub.Broadcast(entry.TripID, {"event": "entries_updated", ...})`,其他成員(與自己的第二個分頁)會即時看到手動修改。此項不再是 Phase 1 阻塞。',
        '刪除鈕:端點已存在——`DELETE /v1/trips/{id}/entries/{entryID}`(`handleDeleteTripEntry`,前端 `api.ts` 的 `deleteTripEntry`;同 3.2 undo 所需,一魚兩吃)。按下後卡片走與 AI 刪除相同的塌陷動畫 + 5 秒復原條。',
        '欄位清空限制(空字串=不改)如實揭露在 UI:留空的欄位顯示 placeholder「留空表示不改」(現況已有),Phase 2 隨 API 語意修正後開放清空。',
      ],
    },
    {
      heading: '4.2 新增一筆',
      paragraphs: ['兩個入口,對應兩種心智:'],
      bullets: [
        '從日期新增:時間軸每個日期標籤(`tl-date-day`)可點,彈出該日操作選單:「＋ 新增一筆」「🗺 看這天的地圖」。新增開啟空白版編輯表單,日期預填該日。空白日(blank row)整列可點,行為相同——把「這天還沒安排」變成入口而非死區。',
        '從推薦新增:見推薦整合流程一章。',
        '寫入走 `POST /v1/trips/{id}/entries`(`handleCreateTripEntry`,前端封裝 `api.ts` 的 `createTripEntry`)。',
      ],
      note: '原先的折衷方案(端點存在之前的 Phase 1,表單「儲存」改為組一句結構化訊息送 `assist` 由 AI 寫入)已無必要:端點與前端封裝都已存在,新增表單可直接走 REST,Phase 1 即可直連。',
    },
    {
      heading: '4.3 調整時間與順序',
      paragraphs: [
        '時間軸的排序完全由 `start + startTime` 決定(無獨立 order 欄位),因此「調順序」本質是「改時間」。設計三個層次,由輕到重:',
      ],
      bullets: [
        '快速時間 chips(Phase 1):卡片展開後,編輯鈕旁併排「⏰ 改時間」直接彈 time picker + 常用時段 chips,不必進完整表單。改完即走 PATCH + `.updating` 光影。',
        '跨日拖曳(Phase 2):長按卡片 300ms 進入拖曳,拖到另一個日期區段放開 = 改 start 日期、時刻不變。語意清楚、無歧義,是拖曳的主場景。拖曳中目標日期列高亮,放開後卡片在新位置播進場動畫。',
        '同日拖曳排序(Phase 2,謹慎):放到同日兩卡之間時,新時刻取前後兩卡時刻的中點(10:00 與 14:00 之間 → 12:00);前後同刻或無法取中時,放開後立即彈 time picker 請使用者定奪。',
      ],
      note: '誠實標註:同日拖曳這條手勢的邊界情況多(全日事件無時刻、跨日主線條目不參與拖曳),實作成本高於價值的疑慮存在;若 Phase 2 資源緊,同日排序可先交給對話(「把晴空塔排到淺草寺前面」)——AI 改時間本來就是這套系統的強項。',
    },
    {
      heading: '4.4 手動與 AI 的視覺語言一致',
      bullets: [
        '手動儲存時,前端本地把該 entryID 加進 `updatingEntryIDs`(與 WS `entry_updating` 同一個 state),完成後解除——光影動畫與 AI 路徑完全同款。',
        '手動操作同樣產生回執卡與 undo 記錄(3.2 的 stack 不分來源)。',
        '差異僅在觸發端:沒有海浪泡泡(因為沒有對話),表單/按鈕自身的 loading 態承擔「進行中」。',
      ],
    },
  ],
  tags: ['行程 UX', '手動編輯', '拖曳排序'],
  source: ['docs/itinerary-ux-design.md'],
}
