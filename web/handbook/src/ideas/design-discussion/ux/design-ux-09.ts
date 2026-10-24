import type { IdeaDoc } from '../../types'

export const DESIGN_UX_09: IdeaDoc = {
  id: 'design-ux-09',
  group: 'design-discussion',
  order: 109,
  title: '狀態與邊界情況',
  summary:
    '逐一列出初次載入、AI 推論、WS 斷線、離線、多人編輯、地圖不可用、無座標、追問被關閉與公開頁等情境的現況與設計。',
  sections: [
    {
      heading: '邊界情況對照表',
      table: {
        headers: ['情境', '現況', '設計'],
        rows: [
          [
            '初次載入',
            '空白後直接出現',
            '時間軸骨架屏(灰條日期 + 灰卡 × 3,300ms 內完成則跳過);地理脈絡列待 entries 到位才淡入',
          ],
          [
            'AI 推論中',
            '海浪泡泡 + 佔位卡;recorded 靠 1s 輪詢(上限 20s)',
            '保留;改「WS `entries_updated` 為主、輪詢保底」縮短等待(3.4);逾時文案由沉默改為「AI 仍在處理,稍後條目會自動出現」+ 回執補送',
          ],
          [
            'WS 斷線',
            '`onclose` 無重連,斷了就永久失聯(僅 cleanup close)',
            '指數退避重連(1s→2s→…→30s 上限);navbar 下細黃條「連線中斷,顯示最後同步內容(HH:MM)」;重連成功 → `fetchEntries` 補償 + 黃條退場。斷線期間 HTTP 仍可用:手動編輯照常,AI 操作可送出但進行中回饋缺失(佔位卡/光影不出現),回執卡照常由 HTTP 回覆產生——降級但不阻斷',
          ],
          [
            '離線(`navigator.onLine` = false)',
            '各請求各自報錯',
            '唯讀模式:時間軸/地圖(已載入圖磚)可瀏覽,composer 與編輯入口禁用 + 「離線,僅供瀏覽」;恢復後自動重抓。不做離線寫入佇列(多人資料,離線排隊衝突風險 > 價值)',
          ],
          [
            '多人同時編輯',
            'last-write-wins;PATCH 只覆蓋有帶的欄位(天然縮小衝突面);PATCH 廣播 `entries_updated` 已補上(`handleUpdateEntry` 末尾的 `s.hub.Broadcast`)',
            '他人變更已能即時反映;Phase 1 剩下:自己的編輯表單開啟期間收到該 entry 的變更 → 表單頂黃條「此條目剛被其他成員更新 [載入新值/繼續(將覆蓋)]」。Phase 3:entry 加 `updatedAt`(現只有 createdAt,需 migration),PATCH 帶 baseUpdatedAt → 不符回 409 → 前端逐欄對比對話框',
          ],
          [
            '地圖不可用(無 VITE_GOOGLE_MAPS_API_KEY / 載入失敗)',
            'rp-map-error 文案',
            '地理脈絡列與間隙標籤照常(Haversine 不依賴 Maps SDK);點開地圖位置顯示錯誤卡與重試;功能性退化不連坐',
          ],
          [
            '條目無座標',
            '地圖畫不出(見 6.2)',
            '該點缺席 + 日摘要「1 個地點未定位 [補定位]」;間隙標籤跳過無座標的相鄰對',
          ],
          ['ask_user 被關閉', '追問永久消失', '待回覆 chip(3.3)'],
          [
            '公開頁',
            '無 WS、reload 更新',
            '唯讀地圖與間隙標籤可用;不做即時,頁面標註「內容為載入當下版本」',
          ],
        ],
      },
    },
  ],
  tags: ['行程 UX', '邊界情況', 'WS', '離線'],
  source: ['docs/itinerary-ux-design.md'],
}
