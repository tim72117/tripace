# 後端 API 規格

供 Golang LLM 服務實作。App 端透過 `BackendService` protocol 呼叫,Mock 與真實服務行為一致。
所有回應為 JSON,時間使用 ISO8601 (UTC)。認證之後再加(預留 `Authorization: Bearer <token>`)。

Base URL 範例:`https://api.example.com/v1`

---

## 1. 頻道

### `GET /channels`
取得目前使用者所屬頻道列表。

回應:
```json
{
  "channels": [
    {
      "id": "ch_001",
      "name": "產品討論",
      "memberCount": 4,
      "lastMessagePreview": "我覺得這個功能...",
      "updatedAt": "2026-06-22T01:00:00Z"
    }
  ]
}
```

### `POST /channels`
建立頻道。Body: `{ "name": "string" }`,回應為單一 channel 物件。

### `GET /channels/{channelID}/messages?before=<cursor>&limit=50`
取得頻道訊息(分頁,新到舊)。

回應:
```json
{
  "messages": [ /* Message 物件,見下方 */ ],
  "nextCursor": "msg_120"
}
```

---

## 2. 訊息(含 LLM 分類/標注)

### `POST /channels/{channelID}/messages`
發送訊息。**後端 LLM 在此整理、分類、標注內容**,回傳處理後的訊息。

Request:
```json
{ "text": "明天下午三點開會討論 Q3 預算" }
```

Response (`Message`):
```json
{
  "id": "msg_121",
  "channelID": "ch_001",
  "authorID": "usr_me",
  "authorName": "我",
  "text": "明天下午三點開會討論 Q3 預算",
  "category": "會議",
  "tags": ["排程", "預算", "Q3"],
  "summary": "明日 15:00 開會討論 Q3 預算",
  "createdAt": "2026-06-22T02:30:00Z"
}
```

LLM 職責:
- `category`:單一主分類(如 會議 / 任務 / 問題 / 閒聊 / 公告)
- `tags`:0~N 個關鍵字標籤
- `summary`:一句話摘要(可選,長訊息時提供)

> App 端會先樂觀顯示未標注的訊息(category/tags 為空),收到此回應後就地更新。

---

## 3. 成員

### `GET /channels/{channelID}/members`
回應:`{ "members": [ User 物件 ] }`

### `POST /channels/{channelID}/members`
加入朋友到頻道。Body: `{ "userID": "usr_abc" }`,回應更新後的 members 陣列。

### `DELETE /channels/{channelID}/members/{userID}`
移除成員。

### `GET /users/search?q=<keyword>`
搜尋可邀請的使用者(找朋友)。回應:`{ "users": [ User 物件 ] }`

---

## 4. 語意查詢(RAG)

### `POST /channels/{channelID}/query`
成員用自然語言查詢頻道訊息。**後端對頻道訊息做向量檢索 + LLM 生成回答**。

Request:
```json
{ "question": "上週有討論到預算的決議嗎?" }
```

Response (`SearchAnswer`):
```json
{
  "answer": "上週的會議中決議將 Q3 行銷預算上調 15%,由 Alice 負責執行。",
  "citedMessageIDs": ["msg_088", "msg_090", "msg_095"],
  "confidence": 0.82
}
```

後端建議流程:問句 embedding → 向量庫檢索 Top-K 相關訊息 → 組 prompt → LLM 生成回答,
並回傳被引用的訊息 ID 供 App 顯示來源。`confidence` 可選(0~1)。

---

## 共用型別

### User
```json
{ "id": "usr_abc", "name": "Alice", "avatarColor": "#4A90D9" }
```

## 錯誤格式
```json
{ "error": { "code": "channel_not_found", "message": "..." } }
```
HTTP 狀態碼依語意使用(400 / 401 / 403 / 404 / 500)。
