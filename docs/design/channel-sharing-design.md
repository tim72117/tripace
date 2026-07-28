# 頻道分享設計 - 唯一網址 + 無需登入

## 概述

允許頻道 owner/editor 生成唯一的公開分享連結，任何人可通過該連結無需登入即可查看頻道的所有行程、條目和訊息。

**核心特點：**
- 🔗 唯一分享連結（如 `/share/ch_abc123xyz`）
- 👤 無需登入，匿名訪問
- 🔒 可設定過期時間
- 📊 查看完整的行程日程表
- 🔐 只讀模式（訪客無法編輯）
- 📱 支援多平台（網頁、App 內開啟）

---

## 使用場景

| 場景 | 用途 | 範例 |
|------|------|------|
| 邀請朋友看行程 | 分享旅遊計畫 | 「這是我們的東京之旅，點此查看：http://...」 |
| 團隊協作 | 分享工作計畫 | 「專案里程碑和進度」 |
| 事件宣傳 | 公開活動日程 | 「馬拉松活動時間表」 |
| 日程發布 | 發布日程表 | 「會議室預訂日曆」 |

---

## 功能流程

```
頻道 Owner/Editor
  ↓
[進入頻道設定]
  ↓
[點擊「分享此頻道」]
  ↓
┌─────────────────────────────────┐
│ 分享對話框                       │
├─────────────────────────────────┤
│ ☑ 啟用公開分享                  │
│                                 │
│ 分享連結：[自動生成]           │
│ https://channel.app/share/...  │
│                                 │
│ 過期時間：[設定▼]              │
│ ├─ 永不過期                     │
│ ├─ 1 週                         │
│ ├─ 1 個月                       │
│ ├─ 3 個月                       │
│ └─ 自訂日期                     │
│                                 │
│ □ 只允許編輯者查看（可選）      │
│                                 │
│ [複製連結] [停用分享] [關閉]    │
└─────────────────────────────────┘
  ↓
[複製連結分享（郵件、訊息、社群等）]
  ↓
任何人
  ↓
[訪問連結]
  ↓
[無需登入，直接看到頻道內容]
  ├─ 頻道名稱 + 描述
  ├─ 所有 Trip（時間軸排序）
  ├─ 每個 Trip 的 Entries
  ├─ 訊息歷史（部分或全部）
  └─ 位置地圖
  ↓
[只讀模式 - 無編輯功能]
```

---

## 資料庫設計

### 新增表：channel_shares

```sql
CREATE TABLE channel_shares (
  id TEXT PRIMARY KEY,
  
  -- 被分享的頻道
  channel_id TEXT NOT NULL UNIQUE,
  
  -- 分享者
  created_by TEXT NOT NULL,  -- 頻道 owner/editor
  
  -- 分享連結
  share_token TEXT NOT NULL UNIQUE,  -- 短 token (用於 /share/{token})
  share_url TEXT NOT NULL,           -- 完整 URL (供複製用)
  
  -- 過期控制
  expires_at TIMESTAMP,  -- null = 永不過期
  is_active BOOLEAN DEFAULT true,    -- 可手動停用
  
  -- 訪問控制
  require_auth BOOLEAN DEFAULT false, -- 是否需要登入
  accessible_roles TEXT,              -- JSON: ["editor", "viewer"] 或 null (所有人)
  
  -- 統計
  view_count INT DEFAULT 0,
  last_accessed_at TIMESTAMP,
  
  -- 時間戳
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_share_token (share_token),
  INDEX idx_channel (channel_id),
  INDEX idx_expires (expires_at)
);
```

### 新增表：channel_share_access_log（可選 - 審計）

```sql
CREATE TABLE channel_share_access_log (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  
  -- 訪問者信息
  user_id TEXT,        -- null = 匿名訪問
  ip_address TEXT,
  user_agent TEXT,     -- 用戶使用的設備/瀏覽器
  
  -- 訪問詳情
  accessed_at TIMESTAMP NOT NULL,
  duration_seconds INT, -- 停留時間
  
  FOREIGN KEY (share_id) REFERENCES channel_shares(id),
  INDEX idx_share (share_id),
  INDEX idx_time (accessed_at)
);
```

---

## API 設計

### 分享管理端點

```
POST /v1/channels/{channelID}/share
  建立或更新分享連結
  
  Request:
  {
    expiresAt?: "2026-07-28T23:59:59Z",  // ISO 8601 或 null
    isActive: true,
    requireAuth?: false,                 // 可選：是否需要登入
    accessibleRoles?: null               // 可選：限制為特定角色
  }
  
  Response:
  {
    shareID: "share_001",
    shareToken: "ch_abc123xyz",
    shareURL: "https://channel.app/share/ch_abc123xyz",
    channelID: "ch_001",
    expiresAt: "2026-07-28T23:59:59Z",
    isActive: true,
    createdAt: "2026-06-28T10:00:00Z"
  }

GET /v1/channels/{channelID}/share
  獲取該頻道的分享信息
  
  Response:
  {
    shareID: "share_001",
    shareToken: "ch_abc123xyz",
    shareURL: "...",
    expiresAt: "...",
    isActive: true,
    viewCount: 42,
    lastAccessedAt: "2026-06-28T15:30:00Z"
  }

DELETE /v1/channels/{channelID}/share
  停用或刪除分享
  
  Query: permanent=true (是否永久刪除)
  Response: 200 OK

PUT /v1/channels/{channelID}/share/toggle
  切換分享啟用/停用（無需刪除）
  
  Request: { isActive: false }
  Response: { isActive: false }

PUT /v1/channels/{channelID}/share/reset-token
  重新生成分享 token（舊連結失效）
  
  Response:
  {
    shareToken: "ch_xyz789abc",
    shareURL: "https://channel.app/share/ch_xyz789abc"
  }
```

### 訪問端點（無需認證）

```
GET /share/{shareToken}
  訪問公開分享的頻道
  
  Query:
  - tab?: "timeline" | "messages" | "map"  // 預設 timeline
  
  Response:
  {
    channel: {
      id: "ch_001",
      name: "東京之旅 2026",
      description: "7 天東京行程規劃",
      ownerName: "Alice",      // 只顯示名稱，不顯示 ID
      memberCount: 3
    },
    trips: [
      {
        id: "trip_001",
        title: "東京",
        start: "2026-07-01",
        end: "2026-07-07",
        entries: [
          {
            id: "entry_001",
            item: "去機場",
            start: "2026-07-01 08:00",
            location: "台北松山機場",
            kind: "flight",
            ...
          },
          ...
        ]
      },
      ...
    ],
    shareInfo: {
      sharedBy: "Alice",
      sharedAt: "2026-06-28",
      expiresAt: "2026-07-28"
    }
  }

GET /share/{shareToken}/raw-data
  獲取原始資料（用於 App 內集成）
  
  Response: { channel, trips, entries, messages }
```

---

## 前端設計

### 分享按鈕位置

```
頻道設定 (齒輪圖示)
├─ 頻道信息
├─ 成員管理
├─ ☆ 分享此頻道 (新增)
│  ├─ [分享連結] 複製按鈕
│  ├─ [停用分享]
│  ├─ 過期時間設定
│  └─ 訪問統計
└─ 刪除頻道
```

### 公開分享頁面

```
┌─────────────────────────────────────────┐
│ 東京之旅 2026                           │
│ Alice 分享的行程                        │
├─────────────────────────────────────────┤
│                                         │
│ [📅 時間軸] [💬 訊息] [🗺️ 地圖]        │
│                                         │
│ ┌─────────────────────────────────┐    │
│ │ 2026-07-01 ~ 2026-07-07        │    │
│ │ 東京                             │    │
│ ├─────────────────────────────────┤    │
│ │ ✈️  去機場                       │    │
│ │    台北松山機場 → 成田機場      │    │
│ │    2026-07-01 08:00            │    │
│ │                                 │    │
│ │ 🏨 Hotel Sunroute Plaza        │    │
│ │    東京新宿 | 7 晚            │    │
│ │    2026-07-01 ~ 2026-07-08    │    │
│ │                                 │    │
│ │ 🎌 淺草寺                       │    │
│ │    東京浅草 | 2 小時          │    │
│ │    2026-07-02 09:00            │    │
│ │                                 │    │
│ │ ... 更多條目                   │    │
│ └─────────────────────────────────┘    │
│                                         │
│ 🔗 此連結將於 2026-07-28 過期         │
│                                         │
│ [📋 複製內容到我的頻道]（需登入）      │
│                                         │
└─────────────────────────────────────────┘
```

### 只讀模式指示

```
訪問者在公開分享頁面看到的限制：
├─ ❌ 無法編輯、刪除任何內容
├─ ❌ 無法添加訊息或條目
├─ ❌ 無法邀請成員
├─ ✅ 可查看所有 Trip 和 Entry
├─ ✅ 可查看地圖和時間軸
├─ ✅ 可查看訊息歷史（如許可）
└─ ✅ 可複製到自己的頻道（需登入）
```

---

## 安全考量

### 權限檢查

```
誰可以創建分享連結？
├─ 頻道 Owner       ✅ 是
├─ Editor 成員      ✅ 是（如設定允許）
├─ Viewer 成員      ❌ 否
└─ 非成員           ❌ 否
```

### 訪問控制

```
分享連結的訪問權限
├─ 未登入用戶       ✅ 可訪問（預設）
├─ 任何登入用戶     ✅ 可訪問
├─ 特定角色用戶     ✅ 可限制（可選）
└─ 過期後           ❌ 404 Not Found
```

### 數據隱私

```
公開分享頁面不顯示：
├─ ❌ 用戶郵箱地址
├─ ❌ 用戶 ID
├─ ❌ 成員聯絡方式
├─ ❌ 敏感訊息（如附件）
└─ ❌ 頻道設定詳情

公開分享頁面顯示：
├─ ✅ 用戶顯示名稱
├─ ✅ 用戶頭像顏色
├─ ✅ Trip 和 Entry 內容
├─ ✅ 位置、時間、描述
└─ ✅ 訊息歷史（部分）
```

---

## URL 設計

### 短 Token 方案

```
頻道 ID: ch_6f7a9e2d
短 Token: ch_6f7a9e2d   (簡單起見，直接用頻道 ID)

或使用 Base32 編碼的短 token:
Encode(ch_6f7a9e2d) = A7B9K2M4  (6-8 字元)

分享 URL:
https://channel.app/share/ch_6f7a9e2d

QR Code 指向此 URL
```

### 多語言支援

```
GET /share/{shareToken}?lang=zh-TW  (繁體中文)
GET /share/{shareToken}?lang=en-US  (英文)
GET /share/{shareToken}?lang=ja-JP  (日文)
```

---

## 前端集成

### 複製到自己的頻道

```
訪問者點擊「複製到我的頻道」

1. 如果未登入 → 跳轉登入
2. 登入後 → 顯示頻道選擇對話框
   ├─ [我的頻道 A]
   ├─ [我的頻道 B]
   ├─ [我的頻道 C]
   └─ [新建頻道]

3. 選擇目標頻道 → 複製整個 Trip 結構
   ├─ 複製所有 Trip
   ├─ 複製所有 Entry
   ├─ 標記來源 (source_channel_id = ch_001)
   └─ 顯示「複製成功」

4. 提供快捷鏈結到新 Trip
```

---

## 統計和分析（可選）

```
頻道分享的數據：
├─ 總訪問次數
├─ 唯一訪客數
├─ 平均停留時間
├─ 訪問來源裝置
├─ 最受歡迎的時間段
└─ 複製到其他頻道的次數
```

---

## 實施步驟

### Phase 1 (MVP) - 核心功能
- [ ] 建立 channel_shares 表
- [ ] POST /v1/channels/{id}/share (建立分享)
- [ ] GET /share/{token} (公開訪問)
- [ ] DELETE /v1/channels/{id}/share (停用)
- [ ] 前端：分享按鈕 + 對話框
- [ ] 前端：公開分享頁面
- [ ] 前端：只讀模式

### Phase 2 - 增強
- [ ] 過期時間設定
- [ ] 重新生成 token
- [ ] 訪問統計
- [ ] 複製到自己的頻道功能

### Phase 3 - 優化
- [ ] 審計日誌 (access_log 表)
- [ ] 訪問來源分析
- [ ] QR Code 生成
- [ ] 郵件邀請附帶分享連結

---

## 對比：Trip 分享 vs 頻道分享

| 功能 | Trip 分享 | 頻道分享 |
|------|---------|--------|
| 分享對象 | 單個 Trip | 整個頻道 |
| 無需登入 | ✅ (公開連結) | ✅ |
| 權限管理 | 複雜 (多方確認) | 簡單 (Owner/Editor) |
| 導入方式 | 複製單個 Trip | 複製全部 |
| 即時通知 | ✅ (郵件邀請) | ❌ (連結分享) |
| 協作編輯 | ❌ | ❌ (只讀) |
| 過期機制 | ✅ | ✅ |

**結論：頻道分享更簡單，適合快速分享完整行程日程。**
