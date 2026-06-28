# 公開連結設計（Minimal Version）

## 概述

用唯一的公開連結分享頻道，任何人無需登入即可查看。

---

## 使用流程

```
Owner/Editor
  ↓
[進入頻道]
  ↓
[分享按鈕]
  ↓
[生成公開連結]
  ↓
https://channel.app/public/ch_abc123xyz
  ↓
[複製連結]
  ↓
分享給朋友
  ↓

任何人點擊連結
  ↓
[無需登入]
  ↓
[查看頻道時間軸]
  ↓
[只讀模式]
```

---

## 資料庫設計

### 新增表：public_links

```sql
CREATE TABLE public_links (
  id TEXT PRIMARY KEY,
  channel_id TEXT UNIQUE NOT NULL,
  link_token TEXT UNIQUE NOT NULL,  -- 短 ID (如 ch_abc123xyz)
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_link_token (link_token),
  INDEX idx_channel_id (channel_id)
);
```

**只有 3 個欄位！**

---

## API 設計

### 建立連結
```
POST /v1/channels/{channelID}/public-link

Response:
{
  linkToken: "ch_abc123xyz",
  publicURL: "https://channel.app/public/ch_abc123xyz"
}
```

### 查詢連結
```
GET /v1/channels/{channelID}/public-link

Response:
{
  linkToken: "ch_abc123xyz",
  publicURL: "https://channel.app/public/ch_abc123xyz",
  createdAt: "2026-06-28T10:00:00Z"
}
```

### 刪除連結
```
DELETE /v1/channels/{channelID}/public-link

Response: 200 OK
```

### 公開訪問（無需認證）
```
GET /public/{linkToken}

Response:
{
  channel: {
    name: "東京之旅 2026",
    ownerName: "Alice"
  },
  trips: [ Trip, Trip, ... ],
  entries: [ Entry, Entry, ... ]
}
```

---

## 前端設計

### 分享按鈕

```
頻道標題欄
├─ [頻道名稱]
├─ [⚙️ 設定]
└─ [🔗 分享]  ← 新增按鈕
```

### 分享彈窗

```
┌─────────────────────────────────┐
│ 分享此頻道                       │
├─────────────────────────────────┤
│                                 │
│ 公開連結：                      │
│ https://channel.app/public/...  │
│                                 │
│ [複製] [完成]                   │
│                                 │
└─────────────────────────────────┘
```

### 公開頁面 (/public/{linkToken})

```
┌─────────────────────────────────┐
│ 東京之旅 2026                   │
│ Alice 分享                      │
├─────────────────────────────────┤
│                                 │
│ [📅 時間軸] [🗺️ 地圖]          │
│                                 │
│ ┌──────────────────────────┐    │
│ │ Jul 1-7 │ 東京          │    │
│ ├──────────────────────────┤    │
│ │ ✈️  機票                 │    │
│ │ 🏨 飯店                 │    │
│ │ 🎌 景點                 │    │
│ │ 🍣 餐廳                 │    │
│ └──────────────────────────┘    │
│                                 │
└─────────────────────────────────┘
```

---

## 權限

```
誰可以建立公開連結？
├─ Owner        ✅
├─ Editor       ✅
├─ Viewer       ❌
└─ 非成員       ❌

訪問公開連結？
├─ 任何人       ✅
├─ 無需登入     ✅
```

---

## 實施步驟

- [ ] 建立 public_links 表
- [ ] POST /v1/channels/{id}/public-link
- [ ] GET /v1/channels/{id}/public-link
- [ ] DELETE /v1/channels/{id}/public-link
- [ ] GET /public/{token}
- [ ] 前端：分享按鈕
- [ ] 前端：分享彈窗
- [ ] 前端：公開頁面

**完成！** 就這麼簡單。
