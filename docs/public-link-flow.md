# 公開連結 - 流程圖

## 1. 建立公開連結

```
Owner/Editor
  │
  ├─ [進入行程]
  │
  ├─ [點擊 🔗 分享按鈕]
  │
  ├─ POST /v1/trips/{tripID}/public-link
  │  │
  │  └─ Response:
  │     {
  │       linkToken: "trip_abc123xyz",
  │       publicURL: "https://tripace.app/public/trip_abc123xyz"
  │     }
  │
  ├─ 存入資料庫：
  │  public_links 表
  │  ├─ id: "link_001"
  │  ├─ trip_id: "trip_001"
  │  ├─ link_token: "trip_abc123xyz"
  │  ├─ created_by: "user_a"
  │  └─ created_at: now()
  │
  ├─ [前端顯示連結]
  │  https://tripace.app/public/trip_abc123xyz
  │
  ├─ [複製連結]
  │
  └─ [分享出去]
```

## 2. 訪問公開連結

```
任何人 (無需帳號)
  │
  ├─ 收到連結
  │  https://tripace.app/public/trip_abc123xyz
  │
  ├─ 點擊連結
  │
  ├─ GET /v1/public/{linkToken}
  │  │
  │  └─ 系統檢查：
  │     ├─ link_token 存在？
  │     │  ├─ 是 → 繼續
  │     │  └─ 否 → 404
  │     │
  │     └─ 查詢資料庫
  │        ├─ 獲取 trip_id
  │        ├─ 查詢行程名稱(GetTripName)
  │        ├─ 查詢 entries (其中 trip_id = ...)
  │        └─ 組合成回應
  │
  ├─ Response:
  │  {
  │    tripID: "trip_001",
  │    tripName: "東京之旅",
  │    editable: false,
  │    viewMode: "timeline",
  │    entries: [ ... ]
  │  }
  │
  ├─ [前端渲染公開頁面]
  │  ├─ 行程名稱
  │  ├─ 時間軸
  │  ├─ 所有 Entry
  │  └─ 地圖 (如果有位置)
  │
  └─ [唯讀——editable 旗標目前已失效,不論開關狀態皆恆為唯讀,見第 11 節]
```

## 3. 刪除公開連結

```
Owner/Editor
  │
  ├─ [進入行程設定]
  │
  ├─ [點擊刪除連結]
  │
  ├─ DELETE /v1/trips/{tripID}/public-link
  │  │
  │  └─ 刪除 public_links 記錄
  │     ├─ WHERE trip_id = "trip_001"
  │     └─ 舊連結變成 404
  │
  └─ ✅ 完成
```

## 4. 資料庫查詢流程

```
GET /v1/public/{linkToken}

Step 1: 查詢連結
  SELECT * FROM public_links WHERE link_token = '{linkToken}'

Step 2: 獲取 trip_id
  trip_id = "trip_001"

Step 3: 查詢行程名稱
  SELECT name FROM trips WHERE id = "trip_001"

Step 4: 查詢條目
  SELECT * FROM entries WHERE trip_id = "trip_001"

Step 5: 組合回應
  {
    tripID: "trip_001",
    tripName: "...",
    editable: false,
    viewMode: "timeline",
    entries: [ ... ]
  }

Step 6: 前端渲染
  ✅ 公開頁面
```

## 5. 簡單的狀態

```
建立 → 有效(永久) → 刪除

無其他狀態，就這樣。
```

沒有過期時間、沒有停用旗標、沒有訪問次數上限——**連結建立後永久有效**，唯一的撤銷方式是 `DELETE`（見第 3 節）。

唯一的變化維度是 `editable`（可寫/唯讀）與 `viewMode`（timeline/pace），兩者都可在連結存續期間隨時切換。

## 6. 完整的 URL 流程

```
Owner 生成連結：
  link_token = "trip_6f7a9e2d" (直接用 trip_id)
  
  或使用短編碼：
  link_token = "A7B9K2M4" (Base32 編碼)

分享 URL：
  https://tripace.app/public/trip_6f7a9e2d
  
QR Code：
  ┌──────────────┐
  │    QR CODE   │
  │  掃描訪問   │
  └──────────────┘
  
任何設備點擊 → GET /v1/public/{linkToken} → 公開頁面
```

## 7. 前端 UI 流程

### 建立連結

```
行程介面

[行程名稱] - [🔗 分享]
          
          ↓ 點擊

┌─────────────────────────┐
│ 分享此行程              │
├─────────────────────────┤
│                         │
│ 公開連結：             │
│ https://tripace.app... │
│                         │
│ [複製] [關閉]          │
│                         │
└─────────────────────────┘
```

### 公開頁面 (/public/{token})

```
┌─────────────────────────────────┐
│ 東京之旅 2026                   │
│ Alice 分享                      │
├─────────────────────────────────┤
│                                 │
│ [📅 時間軸] [🗺️ 地圖]          │
│                                 │
│ ┌──────────────────────────────┐│
│ │ 2026-07-01 ~ 07-07         ││
│ │ 東京                         ││
│ ├──────────────────────────────┤│
│ │ ✈️  機票 - 2026-07-01 08:00  ││
│ │ 🏨 飯店 - 7 晚               ││
│ │ 🎌 淺草寺 - 2026-07-02 09:00││
│ │ 🍣 築地 - 2026-07-03 11:00  ││
│ │ 🗼 東京鐵塔 - 2026-07-04   ││
│ │ ... 更多                     ││
│ └──────────────────────────────┘│
│                                 │
│ 唯讀(editable=false 時)        │
│ ※ editable=true 時此處另有     │
│   AI 對話輸入框,訪客可寫入     │
│                                 │
└─────────────────────────────────┘
```

## 8. 完整時序圖

```
Owner                System               Visitor
  │                    │                    │
  ├─ POST /v1/trips/{id}/public-link       │
  │                    │                    │
  │                  建立記錄                │
  │                    │                    │
  │ ← Response: {linkToken, publicURL}    │
  │                    │                    │
  ├─ 複製連結          │                    │
  │                    │                    │
  ├─ 分享              │                    │
  │                    │       收到連結      │
  │                    │                 ← │
  │                    │                    │
  │                    │     點擊連結        │
  │                    │ ← GET /v1/public/{...} │
  │                    │                    │
  │                    ├─ 查詢公開連結    │
  │                    ├─ 查詢行程名稱   │
  │                    ├─ 查詢 Entry    │
  │                    │                    │
  │                    │ Response: {tripID, tripName, entries, ...}
  │                    │ ─────────────────→ │
  │                    │                    │
  │                    │               渲染頁面 │
  │                    │                    │
  │                    │            顯示時間軸 │
```

## 9. API 完整規格

### 建立連結
```
POST /v1/trips/{tripID}/public-link

Permission: owner/editor
Response 200:
{
  "id": "link_001",
  "tripID": "trip_001",
  "linkToken": "trip_abc123xyz",
  "publicURL": "https://tripace.app/public/trip_abc123xyz",
  "createdAt": "2026-06-28T10:00:00Z"
}
```

### 查詢連結
```
GET /v1/trips/{tripID}/public-link

Permission: owner/editor/viewer (該行程成員)
Response 200:
{
  "id": "link_001",
  "linkToken": "trip_abc123xyz",
  "publicURL": "https://tripace.app/public/trip_abc123xyz",
  "createdAt": "2026-06-28T10:00:00Z"
}

Response 404: 連結不存在
```

### 刪除連結
```
DELETE /v1/trips/{tripID}/public-link

Permission: owner/editor
Response 200: OK
Response 404: 連結不存在
```

### 公開訪問
```
GET /v1/public/{linkToken}

Permission: 無需認證 (任何人)

Response 200:
{
  "tripID": "trip_001",
  "tripName": "東京之旅 2026",
  "editable": false,
  "viewMode": "timeline",
  "entries": [
    {
      "id": "entry_001",
      "item": "機票",
      "start": "2026-07-01 08:00",
      "location": "桃園機場",
      "kind": "flight"
    }
  ]
}

Response 404: 連結不存在或已刪除
```

## 10. 實施檢查清單

- [ ] Database: 建立 public_links 表
- [ ] Backend: POST /v1/trips/{id}/public-link
- [ ] Backend: GET /v1/trips/{id}/public-link
- [ ] Backend: DELETE /v1/trips/{id}/public-link
- [ ] Backend: GET /v1/public/{linkToken}
- [ ] Frontend: 分享按鈕 (行程頁面)
- [ ] Frontend: 分享彈窗
- [ ] Frontend: 公開頁面 (/public/{token})
- [ ] Frontend: 時間軸 Tab
- [ ] Frontend: 地圖 Tab (可選)
- [ ] Testing: 權限檢查
- [ ] Testing: 創建/查詢/刪除流程
- [ ] Testing: 無登入訪問

**完成！**

## 11. editable 旗標：目前恆為唯讀

公開連結目前**不論 `editable` 開關切成什麼，一律唯讀**。

`editable` 欄位、DB 欄位、`POST`/`GET /v1/trips/{id}/public-link` 的讀寫 API、`web/src/trip/TripManageModal.tsx` 的 UI 開關都還在，切換後也會被存下來，但沒有任何後端路徑會讀這個旗標做權限判斷——公開連結頁面（`GET /v1/public/{token}`）只回傳資料供閱讀，訪客端沒有對話/寫入介面。

前端對話（`ChatScreen.tsx`）走 onagent 平台（`web/src/chat/useOnagentChatBridge.ts`），採全域單一連線（`APP_ID = 'tripace'`），不區分「這次對話屬於哪個 trip、是否透過已 `editable` 的公開連結進入」，因此公開連結目前沒有任何授權寫入的路徑。

`POST /v1/public/{token}/compute-route`（`handlePublicComputeRoute`）不受此影響，仍然存在、只做路線計算、不寫入資料，並限制 `entryIDs` 必須屬於該 token 對應的行程。

**待辦**：若要讓公開連結支援匿名寫入協作，需要在 `useOnagentChatBridge`／onagent 的 dispatch 協定裡補上「這次對話屬於哪個 trip、是否透過已 `editable` 的公開連結進入」這組上下文，並在 `internal/onagenttools` 對應的寫入類工具裡加入授權檢查——目前完全沒有這層機制。

相關程式碼：`server/internal/api/public_link.go`、`server/internal/store/entity.go` 的 `publicLinkRow.Editable`、`web/src/trip/TripManageModal.tsx`（UI 開關）、`web/src/chat/useOnagentChatBridge.ts`。
