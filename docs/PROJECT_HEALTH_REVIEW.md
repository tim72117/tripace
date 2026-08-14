# 專案健康度檢查(2026-07-22 初版,2026-08-03 更新)

範圍:`server/`(Go 後端)、`web/` + `web/admin/`(React/TypeScript 前端)、`ios/`(Swift App)。掃描方式為結構性檢視(檔案數量、行數、依賴版本、CI 設定),非逐檔 code review。

## 安全性(優先處理)

- **CORS 全開放 `*`——本節唯一仍然成立的問題,尚未修復(2026-08-03 複查確認)。**`server/internal/api/middleware.go` 的 `cors()` 目前仍是 `w.Header().Set("Access-Control-Allow-Origin", "*")`,程式碼自己的註解也還寫著「正式環境應收斂 Allow-Origin 為白名單,這是已知待處理項目」。正式環境用的就是這個設定,沒有依環境切換的邏輯。建議至少讀環境變數決定允許的 origin 清單。
  - 注意:本節其餘項目與本文其他章節多數已隨開發進度解決或數字已更新,**不要因此推論 CORS 也一併修好了**——它沒有。
- ~~**`INTERNAL_API_TOKEN` 未設定時預設放行**~~——**已解決**:`internalAuth`(`server/internal/api/middleware.go`)已改為與 `/v1/*` 一般使用者共用同一套 JWT 驗證(`auth.Signer`),不再有共享密鑰環境變數,也不存在「忘記設定就等於不設防」的分支,驗證失敗一律回 401。CLI 端透過 `tripace-cli login --web` 換發 JWT。
- ~~`web/.env.development` 被 git 追蹤~~——**已確認非問題**:該檔案內容只有註解說明與非機密設定(`VITE_API_BASE`、`VITE_ONAGENT_URL` 位址,以及設計上本就可公開的 `VITE_PACE_PUBLIC_LINK_TOKEN`),不含任何金鑰值;真正的金鑰(`VITE_GOOGLE_MAPS_API_KEY`、`VITE_ONAGENT_APP_KEY`)放在 gitignore 排除的 `.env.development.local`。
- (2026-08-03 補充,不在本文原始掃描範圍)公開分享連結的 `editable` 開關:開啟後未登入訪客可透過 AI 對話寫入該行程,且連結永久有效、無訪問紀錄。這是刻意的設計權衡而非缺陷,但安全意涵需明確認知——詳見 `docs/PUBLIC_LINK_DESIGN.md` 的「權限」段落。

## 測試(目前是最大缺口)

- Go 測試覆蓋率低:全專案 12 個 `*_test.go`,對比 100 個 `.go` 檔案,比例約 12%(初版掃描時為 8/89)。`internal/api` 已不再是完全空白——已有 `auth_test.go`、`cliauth_device_test.go` 兩支,但相對於該套件的路由與權限邏輯量仍明顯不足,`requireOwner`/`requireEditor`/`requireMember` 這類權限檢查與公開連結端點都還沒有測試覆蓋,是目前風險最集中的地方。
- 前端完全沒有單元測試(`web/`、`web/admin/` 皆無 `*.test.ts`/`*.test.tsx`,也沒有 vitest/jest),只有一支 e2e(`web/tests/e2e-mock-llm.spec.ts`,串 mock LLM)。
- **CI 沒有任何一個 workflow 執行測試**——六個 workflow(`deploy-cloudrun.yml`、`deploy-admin.yml`、`deploy-migrate.yml`、`inspect-cloudrun.yml`、`ios-build.yml`、`reset-admin-password.yml`)都只做 build/deploy/維運操作,iOS workflow 也只是 `xcodebuild ... build` 純編譯檢查。等於「能編譯過」是目前唯一的自動化品質門檻。
- 建議:先把已有的 12 個 Go test、`e2e-mock-llm.spec.ts` 接進 CI,形成一道底線,之後再逐步補測試覆蓋——比從零開始建立習慣容易。

## 依賴與架構耦合

- ~~私有依賴 `github.com/tim72117/want v0.0.2`~~——**已解決**(2026-08-14):`server/internal/wanttools/` 對 `want/types` 的引用已改為本地定義(見該套件的 `wanttypes.go`),`want` 已從 `go.mod`/`go.sum` 完全移除。連帶讓 4 支 Dockerfile 的 `GH_PAT` build-arg、5 個 GitHub Actions workflow 的對應設定都不再需要。`internal/wanttools/` 本身沒有被任何 binary import(`go list -deps` 對 `cmd/server`/`cmd/adminserver`/`cmd/cli` 驗證過皆為空),是保留下來的舊 want 對話系統工具實作,未被刪除。
- 兩個前端子專案版本已分岔:`web/`(TypeScript 5.6、Vite 5.4)vs `web/admin/`(TypeScript 7.0、Vite 6.0)。建議找時機同步,避免越拖越難統一。

## 程式碼組織

- ~~`web/src/App.tsx`(1295 行)是最大的技術債訊號~~——**已解決**:`App.tsx` 目前只有 112 行。內容已拆成 `AppCommon`/`DesktopLayout`/`PhoneContent`/`PhoneNavDrawer`/`SettingsScreen` 等元件,且導入 React Router 後只剩路由骨架。
- `web/src/ChatScreen.tsx`(911 行)已有過一次拆分嘗試(commit `9b0b425`),但行數不減反增,目前是前端最大的單一檔案,值得再排一輪拆分。
- `server/internal/wanttools/` 的工具檔案裡只有 2 個(`sink.go`、`task_plan.go`)有對應測試。考慮到這些工具直接被 LLM 呼叫、影響使用者資料,優先給高風險的寫入類工具(`trip_entry_add`/`update`/`delete`)補測試,比全面鋪開更划算。這一點在公開連結開啟 `editable` 時更重要——那條路徑上未登入訪客的輸入會一路走到這些寫入工具。
- TODO/FIXME/HACK 密度低(`server/` 僅 1 處、`web/src/` 0 處)——不是壓抑技術債達成,是專案還年輕(2026-06-22 第一個 commit,至今約六週),累積時間短。

## 文件

- ~~`docs/API.md` 的認證章節過時、`docs/ARCHITECTURE.md` 自專案第一天後未再更新~~——**已於 2026-08-03 處理**:這兩份(連同 `docs/ROADMAP.md`、`server/README.md`、`docs/pace-demo-data-audit.md`)描述的是「iOS + Mock 後端 + 訊息分類 + RAG 向量檢索」那個早期構想,與現行「多端 + Entry + agent tool calling」架構已不是同一個系統,修補成本高於重寫,故直接刪除。**目前專案缺少後端 API 規格與整體架構這兩類文件**,待重寫。
- ~~沒有 `CLAUDE.md`~~——**已解決**:已有 `.claude/CLAUDE.md`(目前內容精簡,僅記載對話語言慣例,可視需要再補專案結構與慣例)。
- `docs/CHANNEL_SHARING_DESIGN.md` 與 `docs/CHANNEL_SHARING_FLOW.md` 描述的是**未採用的設計方案**(整套 `/share` API 與過期/停用/require_auth/訪問統計等機制都沒有實作),已於 2026-08-03 在兩份文件開頭補上醒目的狀態標註。實際實作見 `docs/PUBLIC_LINK_DESIGN.md`/`PUBLIC_LINK_FLOW.md`。

## 部署維運

- 三個 Dockerfile(`Dockerfile`、`Dockerfile.admin`、`Dockerfile.migrate`)都沒有 `HEALTHCHECK` 指令。
- 沒有 APM/tracing/error-tracking 整合(Sentry、OpenTelemetry 等完全沒有)。
- 近期已發生一次「健康檢查在正式環境失效才發現」的真實案例(commit `dba5145`,adminserver 曾漏設 `AI_PROVIDER`/`GOOGLE_API_KEY`/`GOOGLE_PLACES_API_KEY` 導致健康檢查一直回報未設定),這類問題本來能被監控機制更早攔截。
- GCP 資源命名還留著改名前的舊名(`shuttle-045094509`,專案原名 Shuttle 後改名 Tripace/Pace),純粹是命名一致性問題,不影響功能,但拖久了會增加新人理解的認知負擔。

## 如果只挑一件事先做

把現有的 12 個 Go test 跟 `e2e-mock-llm.spec.ts` 接進 CI——成本低、立即見效,能防止之後的改動不小心讓已經寫好的測試形同虛設。

(安全性方面若只挑一件:收斂 `cors()` 的 `Access-Control-Allow-Origin`——那是本文安全性章節唯一還沒解決的項目。)
