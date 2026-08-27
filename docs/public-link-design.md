# 公開連結設計（Minimal Version）

## 概述

用唯一的公開連結分享行程，任何人無需登入即可查看。

---

## 使用流程

```
Owner/Editor
  ↓
[進入行程]
  ↓
[分享按鈕]
  ↓
[生成公開連結]
  ↓
https://tripace.app/public/trip_abc123xyz
  ↓
[複製連結]
  ↓
分享給朋友
  ↓

任何人點擊連結
  ↓
[無需登入]
  ↓
[查看行程時間軸]
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
  trip_id TEXT UNIQUE NOT NULL,
  link_token TEXT UNIQUE NOT NULL,  -- 短 ID (如 trip_abc123xyz)
  created_by TEXT NOT NULL,
  editable BOOLEAN NOT NULL DEFAULT false,   -- 訪客可否透過 AI 對話寫入(見「權限」)
  view_mode TEXT NOT NULL DEFAULT 'timeline',-- 公開頁呈現方式:timeline / pace
  created_at TIMESTAMP NOT NULL,
  
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_link_token (link_token),
  INDEX idx_trip_id (trip_id)
);
```

實際實作見 `server/internal/store/entity.go` 的 `publicLinkRow`。注意這張表**沒有** `expires_at`、`is_active`、`require_auth`、`view_count` 等欄位——連結一旦建立就永久有效，唯一的撤銷方式是 `DELETE`（真的刪掉那筆記錄）。

---

## API 設計

### 建立連結
```
POST /v1/trips/{tripID}/public-link

Response:
{
  linkToken: "trip_abc123xyz",
  publicURL: "https://tripace.app/public/trip_abc123xyz"
}
```

### 查詢連結
```
GET /v1/trips/{tripID}/public-link

Response:
{
  linkToken: "trip_abc123xyz",
  publicURL: "https://tripace.app/public/trip_abc123xyz",
  createdAt: "2026-06-28T10:00:00Z"
}
```

### 刪除連結
```
DELETE /v1/trips/{tripID}/public-link

Response: 200 OK
```

### 公開訪問（無需認證）
```
GET /v1/public/{linkToken}

Response:
{
  tripID: "trip_abc123xyz",
  tripName: "東京之旅 2026",
  editable: false,
  viewMode: "timeline",
  entries: [ Entry, Entry, ... ]
}
```

---

## 前端設計

### 分享按鈕

```
行程標題欄
├─ [行程名稱]
├─ [⚙️ 設定]
└─ [🔗 分享]  ← 新增按鈕
```

### 分享彈窗

```
┌─────────────────────────────────┐
│ 分享此行程                       │
├─────────────────────────────────┤
│                                 │
│ 公開連結：                      │
│ https://tripace.app/public/...  │
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

### ⚠️ `editable` 開關：欄位仍在，但目前是死功能（不再有任何寫入效果）

`public_links` 有一個 `editable` 欄位（`server/internal/store/entity.go` 的 `publicLinkRow`），建立連結時由 request body 的 `editable` 決定（`server/internal/api/public_link.go` 的 `handleCreatePublicLink`），前端對應的 UI 開關在 `web/src/trip/TripManageModal.tsx`。已建立的連結也可以事後改這個開關。

- `editable` 欄位、DB 欄位、`POST`/`GET /v1/trips/{id}/public-link` 的讀寫 API 都還在，UI 開關也還能切換、還會被存下來。
- 但**沒有任何後端路徑會讀這個旗標去做權限判斷**——切成 `editable = true` 不會讓任何人透過公開連結寫入行程，這個開關目前形同虛設。
- 前端對話（`ChatScreen.tsx`）走 onagent 平台（`web/src/useOnagentChatBridge.ts`），採全域單一連線（`APP_ID = 'tripace'`），不區分「這次對話屬於哪個 trip、是否透過已 `editable` 的公開連結進入」——現在**沒有任何機制**能讓匿名訪客透過公開連結寫入行程，不論 `editable` 開關切成什麼。

| | 唯讀連結 | editable 連結 |
|---|---|---|
| 需要登入 | 否 | 否 |
| 需要是行程成員 | 否 | 否 |
| 可讀取全部 entries | 是 | 是 |
| 可修改/刪除行程資料 | 否 | 否(目前恆為否) |
| 有效期限 | 永久（除非刪除連結） | 永久（除非刪除連結） |
| 有訪問紀錄可稽核 | 無 | 無 |

**待辦**：若要讓公開連結支援匿名寫入協作，需要在 `useOnagentChatBridge`／onagent 的 dispatch 協定裡補上「這次對話屬於哪個 trip、是否透過已 `editable` 的公開連結進入」這組上下文，並在 `internal/onagenttools` 對應的寫入類工具裡加入授權檢查——目前完全沒有這層機制。在此之前，`editable` 欄位與其讀寫 API/UI 開關維持保留、不移除。

---

## 實施步驟

- [ ] 建立 public_links 表
- [ ] POST /v1/trips/{id}/public-link
- [ ] GET /v1/trips/{id}/public-link
- [ ] DELETE /v1/trips/{id}/public-link
- [ ] GET /v1/public/{token}
- [ ] 前端：分享按鈕
- [ ] 前端：分享彈窗
- [ ] 前端：公開頁面

**完成！** 就這麼簡單。
