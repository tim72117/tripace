# tools/record — /ai-plan 展示動畫錄製工具

把主站 `/ai-plan` 的展示動畫錄成廣告素材影片(Facebook/Instagram/Reels)。

**獨立於 `web/`**:自己的 `package.json`、依賴、Vite dev server;不掛在正式站任何路由上,
也**不改任何正式元件**。錄製需要的行為(固定節奏、亮色、字卡觸發、播完偵測)都在這裡從外面做。

## 組成

| 檔案 | 用途 |
|---|---|
| `src/RecordAiPlanPage.tsx` | 錄製專用頁:手機外框 + 字卡,用 iframe 嵌入主站 `/ai-plan?embedded=1` |
| `record-ai-plan.ts` | 錄製腳本(Playwright):連續截圖,再用 ffmpeg 編成 MP4 |
| `vite.config.ts` | 錄製頁的 dev server,固定埠 **5195**(`strictPort`) |

## 前置

- Node 與 `npm install`(在這個資料夾)。
- **ffmpeg**(編碼 MP4 用;Windows:`winget install ffmpeg`)。只想錄影格可以加 `--frames-only`,不需要它。
- Playwright 瀏覽器:跟 `web/` 共用本機快取。`@playwright/test` **固定 1.63.0**,與 `web/` 實際使用的
  版本一致;`web/` 升級 Playwright 時這裡要同步改 `package.json`,否則會要求另一版瀏覽器。

## 使用

要同時開兩個 dev server:

```
cd web && npm run dev                 # 主站 5173(提供被錄的 /ai-plan)
cd tools/record && npm run dev        # 錄製頁 5195(手機外框)
```

手動看畫面:<http://localhost:5195/?ratio=9:16>(頁面上方有比例、背景色、安全區控制列)。
手動看時沒有錄製腳本的調整:打字/步驟延遲是主站原本的樣子、主題跟系統、字卡不會依進度切換。

錄製:

```
cd tools/record
npm run record                                    # 預設 9:16、normal 節奏
npm run record -- --ratio=4:5
npm run record -- --ratio=all --pace=fast
```

輸出在 `tools/record/output/ai-plan-<ratio>-<pace>.mp4`(已被 `.gitignore` 排除)。

除錯:

```
RECORD_FPS=2 npm run record -- --frames-only --ratio=1:1   # 只錄影格、低頻率,快速驗證
npm run typecheck
```

環境變數:`RECORD_URL`(錄製頁網址,預設 `http://localhost:5195`)、`RECORD_FPS`(截圖頻率,預設 30)。

## 它怎麼在不改正式元件的情況下運作

| 需求 | 做法 |
|---|---|
| 隱藏頂部浮動導覽、捲軸把手 | 主站既有的 `?embedded=1` |
| 亮色主題 | Playwright `colorScheme: 'light'` |
| 固定節奏、打字速度、開場定格 | `installPacing`(`addInitScript`)在頁面載入前調整計時器 |
| 字卡依劇本進度出現 | 腳本數主站頁面上的站點卡片,通知殼層頁面 |
| 偵測播完 | 站點數與卡片文字連續 4 秒不變 |

## 會隨主站改動而失效的耦合點

這些都不會報錯地破壞主站,但主站改了就要跟著調整:

- `STOP_CARD_SELECTOR`:依 `PlanTimelineView.module.css` 的 `.stopCard` 與 CSS Modules 命名(`_stopCard_xxx`)。
- `SIM_STOP_IDS`:依 `planSimScript.ts` 的站點順序;殼層 `CAPTIONS` 綁的 stop id 是同一份對照。
- `installPacing`:依劇本延遲範圍(900~1500ms)與打字間隔(90ms);對不上時只是退回主站預設節奏。

## 注意

- 5195 被佔用時 dev server 會直接失敗(不自動換埠);錄製腳本預設連 5195,要改請設 `RECORD_URL`。
- 腳本改寫後的端到端錄製流程**尚未實際驗證過**(選擇器、播完偵測、節奏調整都是依程式碼推導)。
