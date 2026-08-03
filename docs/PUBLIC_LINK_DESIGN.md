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
[預設唯讀模式;若連結建立時開啟 editable 則可透過 AI 對話寫入]
```

> ⚠️ **安全提醒：唯讀是預設值，不是保證。** 見下方「權限」段落的 `editable` 開關說明。

---

## 資料庫設計

### 新增表：public_links

```sql
CREATE TABLE public_links (
  id TEXT PRIMARY KEY,
  channel_id TEXT UNIQUE NOT NULL,
  link_token TEXT UNIQUE NOT NULL,  -- 短 ID (如 ch_abc123xyz)
  created_by TEXT NOT NULL,
  editable BOOLEAN NOT NULL DEFAULT false,   -- 訪客可否透過 AI 對話寫入(見「權限」)
  view_mode TEXT NOT NULL DEFAULT 'timeline',-- 公開頁呈現方式:timeline / pace
  created_at TIMESTAMP NOT NULL,
  
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_link_token (link_token),
  INDEX idx_channel_id (channel_id)
);
```

實際實作見 `server/internal/store/entity.go` 的 `publicLinkRow`。注意這張表**沒有** `expires_at`、`is_active`、`require_auth`、`view_count` 等欄位——連結一旦建立就永久有效，唯一的撤銷方式是 `DELETE`（真的刪掉那筆記錄）。

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

### ⚠️ `editable` 開關：這不是純唯讀的分享機制

`public_links` 有一個 `editable` 欄位（`server/internal/store/entity.go` 的 `publicLinkRow`），建立連結時由 request body 的 `editable` 決定（`server/internal/api/public_link.go` 的 `handleCreatePublicLink`），前端對應的 UI 開關在 `web/src/channel/ShareModal.tsx`。已建立的連結也可以事後改這個開關。

- **`editable = false`（預設）**：訪客只能讀。`POST /v1/public/{token}/assist` 會直接回 403 `read_only`。
- **`editable = true`**：**任何拿到這個連結的人，完全不需要登入、不需要是頻道成員，就能透過 `POST /v1/public/{token}/assist` 送 prompt 給 LLM assistant，並對該頻道執行寫入操作**（`handlePublicAssist` 把 `info.ChannelID` 帶進 `AssistForSession`，assistant 可呼叫 `trip_entry_add`/`update`/`delete` 等寫入類工具）。

這是一個實質的安全權衡，必須明確理解：

| | 唯讀連結 | editable 連結 |
|---|---|---|
| 需要登入 | 否 | **否** |
| 需要是頻道成員 | 否 | **否** |
| 可讀取全部 entries | 是 | 是 |
| 可修改/刪除頻道資料 | 否 | **是（透過 AI 對話）** |
| 有效期限 | 永久（除非刪除連結） | 永久（除非刪除連結） |
| 有訪問紀錄可稽核 | 無 | **無** |

換句話說，開啟 `editable` 等於把該頻道的寫入權限授予「所有知道這串 token 的人」，且沒有過期時間、沒有訪問紀錄、無法辨識是誰改的。連結一旦外流（轉貼、截圖、瀏覽器歷史、聊天記錄），權限就無法針對個別對象撤銷，只能整條連結刪掉。

因此 `editable` 只適合用在**明確、短期、對象可信**的協作情境（例如當面請同行者一起補行程），用完應盡快刪除連結。不要把 editable 連結貼在公開場合。

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
