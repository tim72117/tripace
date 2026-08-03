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
  └─ [唯讀 or 可寫,取決於連結的 editable 旗標]
     ├─ editable = false(預設) → 只能看,POST /v1/public/{token}/assist 回 403 read_only
     └─ editable = true        → 訪客可透過 AI 對話寫入該行程(見第 11 節)
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

## 11. ⚠️ editable 旗標與其安全意涵

公開連結**預設唯讀**，但建立時（或事後）可以開啟 `editable`。開啟後的實際效果必須明確理解：

```
POST /v1/public/{token}/assist        (handlePublicAssist, public_link.go)

  ├─ token 查不到                      → 404
  ├─ info.Editable == false(預設)      → 403 read_only
  └─ info.Editable == true
       │
       └─ assistant.AssistForSession("public:"+token, info.TripID, ...)
            │
            └─ LLM 可呼叫寫入類工具,對 info.TripID 這個行程
               新增/修改/刪除 entry
```

呼叫者**不需要 JWT、不需要登入、不需要是行程成員**——`handlePublicAssist` 除了 `Editable` 之外沒有任何身分檢查。等於：

- 開啟 editable = 把該行程的寫入權限授予「所有知道這串 token 的人」
- 沒有過期時間，權限持續到連結被刪除為止
- 沒有訪問紀錄/稽核日誌，事後無法得知是誰改的
- 無法針對個別對象撤銷，連結一旦外流只能整條刪掉

相對地，另一支公開端點 `POST /v1/public/{token}/compute-route`（`handlePublicComputeRoute`）不受 `editable` 影響，它只做路線計算、不寫入資料，並且會限制 `entryIDs` 必須都屬於這個 token 對應的行程，避免被當成免驗證的跳板去探測其他行程的 entry。

相關程式碼：`server/internal/api/public_link.go`、`server/internal/store/entity.go` 的 `publicLinkRow.Editable`、`web/src/channel/ShareModal.tsx`（UI 開關）。
