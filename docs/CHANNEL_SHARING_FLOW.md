# 頻道分享 - 流程圖

## 1. 完整流程

```
頻道所有者 (Owner) / 編輯者 (Editor)
  │
  ├─ 進入頻道設定 (⚙️ 齒輪圖示)
  │
  ├─ 點擊「分享此頻道」
  │
  ├─ ┌─────────────────────────────────┐
  │  │ 分享設定對話框                  │
  │  ├─────────────────────────────────┤
  │  │ ☑ 啟用公開分享                 │
  │  │                                 │
  │  │ 分享連結：                      │
  │  │ https://channel.app/share/...  │
  │  │ [複製] [重新生成]               │
  │  │                                 │
  │  │ 過期時間：                      │
  │  │ ○ 永不過期                      │
  │  │ ○ 1 週                         │
  │  │ ○ 1 個月                       │
  │  │ ○ 3 個月                       │
  │  │ ○ 自訂日期 [日期選擇器]        │
  │  │                                 │
  │  │ 訪問統計：                      │
  │  │ 👁️ 42 次訪問                    │
  │  │ 🕐 最後訪問：2 小時前          │
  │  │                                 │
  │  │ [停用分享] [刪除分享] [關閉]   │
  │  └─────────────────────────────────┘
  │
  ├─ 複製連結 → 分享到：
  │  ├─ 📧 郵件
  │  ├─ 💬 訊息 App
  │  ├─ 📱 社群媒體
  │  └─ 🔗 其他途徑
  │
  └─ 任何人可訪問連結
     └─ 無需登入

─────────────────────────────────────────

訪客 (任何人)
  │
  ├─ 收到分享連結
  │  └─ https://channel.app/share/ch_abc123xyz
  │
  ├─ 點擊連結
  │
  ├─ [系統檢查]
  │  ├─ 連結是否有效？
  │  │  ├─ YES → 繼續
  │  │  └─ NO  → 404 Not Found
  │  │
  │  └─ 是否過期？
  │     ├─ NO  → 顯示頻道
  │     └─ YES → 「連結已過期」
  │
  ├─ ┌─────────────────────────────────┐
  │  │ 公開分享頁面                    │
  │  ├─────────────────────────────────┤
  │  │                                 │
  │  │ 東京之旅 2026                  │
  │  │ Alice 分享的行程               │
  │  │                                 │
  │  │ [📅 時間軸] [💬 訊息] [🗺️ 地圖]│
  │  │                                 │
  │  │ ┌──────────────────────────┐   │
  │  │ │ 2026-07-01 ~ 07-07     │   │
  │  │ │ 🌸 東京                  │   │
  │  │ ├──────────────────────────┤   │
  │  │ │ ✈️  去機場               │   │
  │  │ │ 🏨 Hotel Sunroute      │   │
  │  │ │ 🎌 淺草寺               │   │
  │  │ │ 🍣 築地市場              │   │
  │  │ │ 🗼 東京鐵塔              │   │
  │  │ │ ... 更多                 │   │
  │  │ └──────────────────────────┘   │
  │  │                                 │
  │  │ 🔗 此連結將於 2026-07-28 過期 │
  │  │                                 │
  │  │ [📋 複製到我的頻道]            │
  │  │    ↓ 需登入                    │
  │  │                                 │
  │  └─────────────────────────────────┘
  │
  └─ 點擊「複製到我的頻道」
     │
     ├─ [如果未登入]
     │  └─ 跳轉登入頁面
     │
     ├─ [如果已登入]
     │  └─ ┌─────────────────────────────┐
     │     │ 選擇頻道                    │
     │     ├─────────────────────────────┤
     │     │                             │
     │     │ 將行程複製到：             │
     │     │ ○ 我的頻道 A              │
     │     │ ○ 我的頻道 B              │
     │     │ ○ 我的頻道 C              │
     │     │ ○ [新建頻道]              │
     │     │                             │
     │     │ [取消] [複製]              │
     │     └─────────────────────────────┘
     │
     └─ 複製完成
        ├─ 後端：複製全部 Trip + Entry
        ├─ 標記來源：source_channel_id
        └─ 前端：顯示「複製成功」+ 快捷連結到新頻道
```

---

## 2. 三大角色流程

### 分享者流程

```
owner/editor
  ↓
[進入頻道設定]
  ↓
[啟用分享] → 系統生成分享連結
  ↓
[設定過期時間] (可選)
  ↓
[複製連結] → 分享給朋友
  ↓
[後續可選操作]
  ├─ 查看訪問統計
  ├─ 重新生成連結 (舊連結失效)
  ├─ 停用分享 (連結變 404)
  └─ 延長過期時間
```

### 訪客流程

```
任何人 (無需帳號)
  ↓
[收到分享連結]
  ↓
[點擊連結]
  ↓
[查看公開分享頁面]
  ├─ 完整行程日程表
  ├─ 所有 Trip 和 Entry
  ├─ 地圖和訊息歷史
  └─ 只讀模式 (無法編輯)
  ↓
[可選：複製到自己的頻道]
  ├─ 需要登入
  └─ 複製後成為自己的頻道副本
```

### App 集成流程

```
Native App (iOS / Android)
  ↓
[掃描 QR Code] 或 [打開分享連結]
  ↓
[系統判斷]
  ├─ 在 App 內打開？
  │  └─ 調用 GET /share/{token}/raw-data
  │     └─ 顯示行程詳情（App UI）
  │
  └─ 在瀏覽器打開？
     └─ 使用 /share/{token} 網頁
```

---

## 3. 數據流轉

### 創建分享

```
Owner/Editor 點擊「分享此頻道」

Request:
POST /v1/channels/{channelID}/share
{
  expiresAt: "2026-07-28T23:59:59Z",
  isActive: true
}

系統生成：
├─ share_token: "ch_6f7a9e2d" (短 token，可用頻道 ID)
├─ share_url: "https://channel.app/share/ch_6f7a9e2d"
└─ created_at: now()

Response:
{
  shareID: "share_001",
  shareToken: "ch_6f7a9e2d",
  shareURL: "https://channel.app/share/ch_6f7a9e2d",
  channelID: "ch_001",
  expiresAt: "2026-07-28T23:59:59Z",
  isActive: true,
  viewCount: 0,
  createdAt: "2026-06-28T10:00:00Z"
}

存入資料庫：
┌─────────────────────────────────────┐
│ channel_shares                      │
├─────────────────────────────────────┤
│ id: share_001                       │
│ channel_id: ch_001                  │
│ created_by: user_a                  │
│ share_token: ch_6f7a9e2d            │
│ share_url: https://...              │
│ expires_at: 2026-07-28T23:59:59Z   │
│ is_active: true                     │
│ view_count: 0                       │
│ created_at: 2026-06-28T10:00:00Z   │
└─────────────────────────────────────┘
```

### 訪問分享

```
訪客訪問： https://channel.app/share/ch_6f7a9e2d

1. 解析 token: ch_6f7a9e2d
2. 查詢資料庫
   └─ SELECT * FROM channel_shares WHERE share_token = 'ch_6f7a9e2d'

3. 檢查
   ├─ is_active == true?
   │  └─ YES → 繼續
   │  └─ NO  → 404 Not Found
   │
   └─ expires_at > now()?
      └─ YES → 繼續
      └─ NO  → 「連結已過期」

4. 計數
   └─ view_count++
   └─ last_accessed_at = now()

5. 返回資料
   └─ GET /share/{token}
      └─ SELECT * FROM trips WHERE channel_id = ch_001
      └─ SELECT * FROM entries WHERE channel_id = ch_001
      └─ 組合成 ChannelShareResponse

6. 前端渲染
   └─ 公開分享頁面
```

### 複製到自己的頻道

```
訪客點擊「複製到我的頻道」

1. 檢查登入狀態
   ├─ 未登入 → 跳轉登入
   └─ 已登入 → 繼續

2. 獲取訪客的頻道清單
   └─ GET /v1/channels (已登入用戶)

3. 訪客選擇目標頻道

4. 複製操作
   Request:
   POST /v1/channels/{targetChannelID}/copy-from-share
   {
     shareToken: "ch_6f7a9e2d"
   }

5. 後端邏輯
   ├─ 檢查訪客有無目標頻道編輯權
   ├─ 查詢原始頻道 (from share_token)
   ├─ 複製所有 Trip
   │  ├─ trip_id (新 ID)
   │  ├─ source_trip_id: (null，因為來自頻道複製)
   │  ├─ source_channel_id: ch_001
   │  ├─ source_user_id: user_a
   │  └─ shared_at: now()
   │
   ├─ 複製所有 Entry
   │  ├─ entry_id (新 ID)
   │  ├─ channel_id: targetChannelID
   │  └─ shared_from_entry_id: (原始 entry_id)
   │
   └─ 更新統計
      └─ channel_shares.view_count++

6. Response
   {
     success: true,
     destinationChannelID: "ch_002",
     copiedTripsCount: 2,
     copiedEntriesCount: 15,
     copiedAt: "2026-06-28T14:30:00Z"
   }

7. 前端
   └─ 顯示「複製成功」
   └─ 提供快捷鏈結到新頻道
```

---

## 4. 狀態機

```
         建立
          │
          ▼
      ┌─────────┐
      │ active  │ ← 分享中
      └────┬────┘
           │
      ┌────┴─────────┐
      │              │
      ▼              ▼
  ┌────────┐    ┌─────────┐
  │disabled│    │ expired │ ← 時間過期 (自動)
  │(手動) │    │(自動)   │
  └────────┘    └─────────┘

說明：
- active   : 分享有效，可訪問
- disabled : 手動停用，連結返回 404
- expired  : 超過 expires_at 時間，自動失效
```

---

## 5. 系統檢查流程

```
訪問 /share/{token}

┌─ Step 1: 解析 token
│  └─ token 存在？
│     ├─ 是 → 繼續
│     └─ 否 → 404 Not Found
│
├─ Step 2: 查詢分享記錄
│  └─ 資料庫查詢
│     ├─ 找到 → 繼續
│     └─ 未找到 → 404 Not Found
│
├─ Step 3: 檢查是否停用
│  └─ is_active == true?
│     ├─ 是 → 繼續
│     └─ 否 → 404 Not Found (分享已停用)
│
├─ Step 4: 檢查是否過期
│  └─ expires_at == null OR expires_at > now()?
│     ├─ 是 → 繼續
│     └─ 否 → 「連結已過期」
│
├─ Step 5: 檢查權限 (可選)
│  └─ require_auth == true?
│     ├─ 是 → 檢查登入狀態
│     │      ├─ 已登入 → 繼續
│     │      └─ 未登入 → 跳轉登入
│     └─ 否 → 繼續 (任何人可訪問)
│
├─ Step 6: 更新訪問統計
│  └─ UPDATE channel_shares
│     SET view_count = view_count + 1,
│         last_accessed_at = now()
│
└─ Step 7: 返回資料
   └─ 查詢 trips + entries
   └─ 組合成 ChannelShareResponse
   └─ 前端渲染公開分享頁面
```

---

## 6. 前端 Tab 結構

### 時間軸 Tab (預設)

```
┌─────────────────────────────────┐
│ 東京之旅 2026                   │
│ Alice 分享的行程                │
├─────────────────────────────────┤
│                                 │
│ [📅 時間軸] [💬 訊息] [🗺️ 地圖] │
│                                 │
│ ┌──────────────────────────────┐│
│ │ Trip Timeline                ││
│ │                              ││
│ │ Jul 1 ━━━━━━━━━━━━ Jul 7   ││
│ │        東京                  ││
│ │                              ││
│ │ ├─ 2026-07-01 08:00         ││
│ │ │  ✈️  去機場                ││
│ │ │                            ││
│ │ ├─ 2026-07-01 18:00         ││
│ │ │  🏨 Check in飯店          ││
│ │ │                            ││
│ │ ├─ 2026-07-02 09:00         ││
│ │ │  🎌 淺草寺                 ││
│ │ │                            ││
│ │ └─ ... 更多                  ││
│ └──────────────────────────────┘│
│                                 │
│ 🔗 此連結將於 2026-07-28 過期   │
│                                 │
│ [📋 複製到我的頻道] (需登入)    │
│                                 │
└─────────────────────────────────┘
```

### 訊息 Tab

```
展示該頻道的聊天歷史 (最近訊息)
或 disable 此 tab (如隱私考量)
```

### 地圖 Tab

```
顯示所有 Entry 的位置
├─ 東京
├─ 淺草
├─ 新宿
└─ ...
```

---

## 7. 與 Native App 的集成

### 在 App 內打開公開分享

```
iOS/Android App 接收分享連結

1. 解析 URL: https://channel.app/share/ch_abc123xyz
2. 判斷域名 → channel.app
3. 路由到內部頁面 (DeepLink)

Method 1: 調用 Native API
GET /share/{shareToken}/raw-data
Response: { channel, trips, entries }
→ App 用自己的 UI 渲染

Method 2: WebView
→ 直接在 WebView 中打開 /share/{shareToken}
```

### QR Code 生成

```
分享者生成 QR Code

QR Code 內容:
https://channel.app/share/ch_abc123xyz

App 掃描 QR Code:
├─ 解析 URL
├─ 如果在 App 內 → DeepLink 打開
└─ 如果在瀏覽器 → Web 頁面打開
```

---

## 8. 實施檢查清單

### Database
- [ ] 建立 channel_shares 表
- [ ] 建立 channel_share_access_log 表 (可選)
- [ ] 添加索引 (share_token, channel_id, expires_at)

### Backend API
- [ ] POST /v1/channels/{id}/share (建立/更新分享)
- [ ] GET /v1/channels/{id}/share (獲取分享信息)
- [ ] DELETE /v1/channels/{id}/share (停用/刪除)
- [ ] PUT /v1/channels/{id}/share/toggle (啟用/停用)
- [ ] PUT /v1/channels/{id}/share/reset-token (重新生成)
- [ ] GET /share/{token} (公開訪問)
- [ ] GET /share/{token}/raw-data (App 用 API)
- [ ] POST /v1/channels/{id}/copy-from-share (複製到自己的頻道)

### Frontend Web
- [ ] 頻道設定頁面 - 分享按鈕
- [ ] 分享對話框組件
- [ ] 公開分享頁面 (/share/{token})
- [ ] 時間軸/訊息/地圖 Tab
- [ ] 複製到我的頻道流程
- [ ] 過期提示

### Frontend App (iOS/Android)
- [ ] DeepLink 處理
- [ ] WebView 集成
- [ ] 公開分享頁面 UI
- [ ] QR Code 掃描

### 測試
- [ ] 權限檢查 (owner/editor 才能建立分享)
- [ ] 過期機制
- [ ] 訪問統計更新
- [ ] 複製功能 (Trip + Entry)
- [ ] 來源追蹤 (source_channel_id 標記)
- [ ] 無需登入訪問
