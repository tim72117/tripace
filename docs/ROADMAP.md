# 開發里程碑

## 階段一：App 介面 + 假後端(目前)
- [x] 規劃文件(架構 / API / Roadmap)
- [x] Xcode SwiftUI 專案骨架(可編譯執行)
- [x] 資料模型 (User / Channel / Message / Tag / SearchAnswer)
- [x] `BackendService` protocol + `MockBackendService`
- [x] 頻道列表畫面
- [x] 聊天 / 發訊息畫面(顯示 LLM 標注)
- [x] 成員管理 / 加朋友畫面
- [x] 語意查詢畫面(顯示回答 + 引用來源)

## 階段二：接真實 Golang 後端
- [ ] 實作 `HTTPBackendService`(依 docs/API.md)
- [ ] App 啟動依環境切換 Mock / HTTP 後端
- [ ] 認證流程(Bearer token)
- [ ] 錯誤處理與重試 / 離線快取

## 階段三：後端 RAG
- [ ] 訊息寫入時做 embedding 入向量庫
- [ ] 查詢端向量檢索 Top-K
- [ ] LLM 分類/標注 prompt 調校
- [ ] LLM 查詢回答 prompt + 引用來源

## 階段四：強化
- [ ] 即時推播 / WebSocket 即時訊息
- [ ] 訊息搜尋過濾(依 category / tag)
- [ ] 多人協作 / 已讀狀態
