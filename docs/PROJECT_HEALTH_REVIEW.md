# 專案健康度檢查(2026-07-22)

範圍:`server/`(Go 後端)、`web/` + `web/admin/`(React/TypeScript 前端)、`ios/`(Swift App)。掃描方式為結構性檢視(檔案數量、行數、依賴版本、CI 設定),非逐檔 code review。

## 安全性(優先處理)

- **CORS 全開放 `*`**(`server/internal/api/middleware.go` 的 `cors()`)——程式碼自己的註解寫著「僅供開發使用,正式環境應收斂 Allow-Origin」,但目前正式環境也是這個設定,沒有依環境切換的邏輯。建議至少讀環境變數決定允許的 origin 清單。
- **`INTERNAL_API_TOKEN` 未設定時預設放行**(`server/internal/api/middleware.go` 的 `internalAuth`)——仰賴部署者「記得」設定,一旦漏掉,`/internal/*` 路由等同無防護。建議改成正式環境(`DEV_MODE=false`)沒設這個 token 就直接 `log.Fatalf` 拒絕啟動,比照 `ADMIN_BOOTSTRAP_*` 那種「缺了就明確報錯」的模式,別讓沉默失敗變成安全洞。
- `web/.env.development`(無 `.local` 後綴)目前被 git 追蹤,值得確認裡面有沒有不該進版控的東西。

## 測試(目前是最大缺口)

- Go 測試覆蓋率低:全專案僅 8 個 `*_test.go`,對比 89 個 `.go` 檔案,比例約 9%。`internal/api`(近 2000 行,核心路由邏輯)完全沒有測試,是目前風險最集中的地方。
- 前端完全沒有單元測試(`web/`、`web/admin/` 皆無 `*.test.ts`/`*.test.tsx`,也沒有 vitest/jest),只有一支 e2e(`web/tests/e2e-mock-llm.spec.ts`,串 mock LLM)。
- **CI 沒有任何一個 workflow 執行測試**——四個 workflow(`deploy-cloudrun.yml`、`deploy-admin.yml`、`ios-build.yml`、`reset-admin-password.yml`)都只做 build/deploy,iOS workflow 也只是 `xcodebuild ... build` 純編譯檢查。等於「能編譯過」是目前唯一的自動化品質門檻。
- 建議:先把已有的 8 個 Go test、`e2e-mock-llm.spec.ts` 接進 CI,形成一道底線,之後再逐步補測試覆蓋——比從零開始建立習慣容易。

## 依賴與架構耦合

- 私有依賴 `github.com/tim72117/want v0.0.2`(LLM/agent 編排核心)是極早期版本號,被 26 個檔案 import。版本沒有穩定承諾,是一個外部風險敞口。
- `server/internal/clienttools/interaction.go` 自陳:want 已內建 `RequestInteraction`/`ResolveInteraction` 機制,但這個專案自己另外刻了一套平行的 `pendingCalls` 機制,作者註記「未來可考慮整合」——是重複造輪子的技術債。
- 兩個前端子專案版本已分岔:`web/`(TypeScript 5.6、Vite 5.4)vs `web/admin/`(TypeScript 7.0、Vite 6.0)。建議找時機同步,避免越拖越難統一。

## 程式碼組織

- `web/src/App.tsx`(1295 行)是目前最大的技術債訊號,遠超一般元件合理大小。
- `web/src/ChatScreen.tsx`(890 行)已有過一次拆分嘗試(commit `9b0b425`)但顯然還沒拆完或拆分後仍偏大,值得再排一輪。
- `server/internal/wanttools/` 13 個工具檔案裡只有 2 個(`sink.go`、`task_plan.go`)有對應測試。考慮到這些工具直接被 LLM 呼叫、影響使用者資料,優先給高風險的寫入類工具(`trip_entry_add`/`update`/`delete`)補測試,比全面鋪開更划算。
- TODO/FIXME/HACK 密度低(`server/` 僅 1 處、`web/src/` 0 處)——不是壓抑技術債達成,是專案還年輕(約一個月),累積時間短。

## 文件

- `docs/API.md` 開頭寫「認證之後再加」,但程式碼裡 JWT/Apple 登入/admin session 認證都已實作完成,這份文件的認證章節已過時。
- `docs/ARCHITECTURE.md` 自 2026-06-22(專案第一天)後未再更新,期間架構變動很大(多套 auth、clienttools 整套機制都是後來加的),與現況脫節風險高。
- 沒有 `CLAUDE.md`——如果之後還會用 Claude Code 協作,建立這個檔案能大幅降低每次對話重新建立上下文的成本。

## 部署維運

- Dockerfile(`Dockerfile`、`Dockerfile.admin`)都沒有 `HEALTHCHECK` 指令。
- 沒有 APM/tracing/error-tracking 整合(Sentry、OpenTelemetry 等完全沒有)。
- 近期已發生一次「健康檢查在正式環境失效才發現」的真實案例(commit `dba5145`,adminserver 曾漏設 `AI_PROVIDER`/`GOOGLE_API_KEY`/`GOOGLE_PLACES_API_KEY` 導致健康檢查一直回報未設定),這類問題本來能被監控機制更早攔截。
- GCP 資源命名還留著改名前的舊名(`shuttle-045094509`,專案原名 Shuttle 後改名 Tripace/Pace),純粹是命名一致性問題,不影響功能,但拖久了會增加新人理解的認知負擔。

## 如果只挑一件事先做

把現有的 8 個 Go test 跟 `e2e-mock-llm.spec.ts` 接進 CI——成本低、立即見效,能防止之後的改動不小心讓已經寫好的測試形同虛設。
