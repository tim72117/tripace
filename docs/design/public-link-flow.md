# 公開連結 - 流程圖

## 1. 建立公開連結

```
Owner/Editor
  │
  ├─ [進入頻道]
  │
  ├─ [點擊 🔗 分享按鈕]
  │
  ├─ POST /v1/channels/{channelID}/public-link
  │  │
  │  └─ Response:
  │     {
  │       linkToken: "ch_abc123xyz",
  │       publicURL: "https://channel.app/public/ch_abc123xyz"
  │     }
  │
  ├─ 存入資料庫：
  │  public_links 表
  │  ├─ id: "link_001"
  │  ├─ channel_id: "ch_001"
  │  ├─ link_token: "ch_abc123xyz"
  │  ├─ created_by: "user_a"
  │  └─ created_at: now()
  │
  ├─ [前端顯示連結]
  │  https://channel.app/public/ch_abc123xyz
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
  │  https://channel.app/public/ch_abc123xyz
  │
  ├─ 點擊連結
  │
  ├─ GET /public/{linkToken}
  │  │
  │  └─ 系統檢查：
  │     ├─ link_token 存在？
  │     │  ├─ 是 → 繼續
  │     │  └─ 否 → 404
  │     │
  │     └─ 查詢資料庫
  │        ├─ 獲取 channel_id
  │        ├─ 查詢 trips (其中 channel_id = ...)
  │        ├─ 查詢 entries (其中 channel_id = ...)
  │        └─ 組合成 PublicLinkResponse
  │
  ├─ Response:
  │  {
  │    channel: { name: "東京之旅", ownerName: "Alice" },
  │    trips: [ ... ],
  │    entries: [ ... ]
  │  }
  │
  ├─ [前端渲染公開頁面]
  │  ├─ 頻道名稱
  │  ├─ 時間軸
  │  ├─ 所有 Trip + Entry
  │  └─ 地圖 (如果有位置)
  │
  └─ [只讀模式 - 無法編輯]
```

## 3. 刪除公開連結

```
Owner/Editor
  │
  ├─ [進入頻道設定]
  │
  ├─ [點擊刪除連結]
  │
  ├─ DELETE /v1/channels/{channelID}/public-link
  │  │
  │  └─ 刪除 public_links 記錄
  │     ├─ WHERE channel_id = "ch_001"
  │     └─ 舊連結變成 404
  │
  └─ ✅ 完成
```

## 4. 資料庫查詢流程

```
GET /public/{linkToken}

Step 1: 查詢連結
  SELECT * FROM public_links WHERE link_token = '{linkToken}'

Step 2: 獲取 channel_id
  channel_id = "ch_001"

Step 3: 查詢頻道
  SELECT * FROM channels WHERE id = "ch_001"

Step 4: 查詢行程
  SELECT * FROM trips WHERE channel_id = "ch_001" ORDER BY start

Step 5: 查詢條目
  SELECT * FROM entries WHERE channel_id = "ch_001"

Step 6: 組合回應
  {
    channel: { ... },
    trips: [ ... ],
    entries: [ ... ]
  }

Step 7: 前端渲染
  ✅ 公開頁面
```

## 5. 簡單的狀態

```
建立 → 有效 → 刪除

無其他狀態，就這樣。
```

## 6. 完整的 URL 流程

```
Owner 生成連結：
  link_token = "ch_6f7a9e2d" (直接用 channel_id)
  
  或使用短編碼：
  link_token = "A7B9K2M4" (Base32 編碼)

分享 URL：
  https://channel.app/public/ch_6f7a9e2d
  
QR Code：
  ┌──────────────┐
  │    QR CODE   │
  │  掃描訪問   │
  └──────────────┘
  
任何設備點擊 → GET /public/{linkToken} → 公開頁面
```

## 7. 前端 UI 流程

### 建立連結

```
頻道介面

[頻道名稱] - [🔗 分享]
          
          ↓ 點擊

┌─────────────────────────┐
│ 分享此頻道              │
├─────────────────────────┤
│                         │
│ 公開連結：             │
│ https://channel.app... │
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
│ 只讀模式 - 無法編輯            │
│                                 │
└─────────────────────────────────┘
```

## 8. 完整時序圖

```
Owner                System               Visitor
  │                    │                    │
  ├─ POST /channels/{id}/public-link      │
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
  │                    │ ← GET /public/{...} │
  │                    │                    │
  │                    ├─ 查詢公開連結    │
  │                    ├─ 查詢頻道       │
  │                    ├─ 查詢 Trip     │
  │                    ├─ 查詢 Entry    │
  │                    │                    │
  │                    │ Response: {channel, trips, entries}
  │                    │ ─────────────────→ │
  │                    │                    │
  │                    │               渲染頁面 │
  │                    │                    │
  │                    │            顯示時間軸 │
```

## 9. API 完整規格

### 建立連結
```
POST /v1/channels/{channelID}/public-link

Permission: owner/editor
Response 200:
{
  "id": "link_001",
  "channelID": "ch_001",
  "linkToken": "ch_abc123xyz",
  "publicURL": "https://channel.app/public/ch_abc123xyz",
  "createdAt": "2026-06-28T10:00:00Z"
}
```

### 查詢連結
```
GET /v1/channels/{channelID}/public-link

Permission: owner/editor/viewer (該頻道成員)
Response 200:
{
  "id": "link_001",
  "linkToken": "ch_abc123xyz",
  "publicURL": "https://channel.app/public/ch_abc123xyz",
  "createdAt": "2026-06-28T10:00:00Z"
}

Response 404: 連結不存在
```

### 刪除連結
```
DELETE /v1/channels/{channelID}/public-link

Permission: owner/editor
Response 200: OK
Response 404: 連結不存在
```

### 公開訪問
```
GET /public/{linkToken}

Permission: 無需認證 (任何人)

Response 200:
{
  "channel": {
    "id": "ch_001",
    "name": "東京之旅 2026",
    "ownerName": "Alice"
  },
  "trips": [
    {
      "id": "trip_001",
      "title": "東京",
      "start": "2026-07-01",
      "end": "2026-07-07"
    }
  ],
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
- [ ] Backend: POST /v1/channels/{id}/public-link
- [ ] Backend: GET /v1/channels/{id}/public-link
- [ ] Backend: DELETE /v1/channels/{id}/public-link
- [ ] Backend: GET /public/{linkToken}
- [ ] Frontend: 分享按鈕 (頻道頁面)
- [ ] Frontend: 分享彈窗
- [ ] Frontend: 公開頁面 (/public/{token})
- [ ] Frontend: 時間軸 Tab
- [ ] Frontend: 地圖 Tab (可選)
- [ ] Testing: 權限檢查
- [ ] Testing: 創建/查詢/刪除流程
- [ ] Testing: 無登入訪問

**完成！**
