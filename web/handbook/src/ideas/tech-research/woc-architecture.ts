import type { IdeaDoc } from '../types'

export const WOC_ARCHITECTURE: IdeaDoc = {
  id: 'research-woc-architecture',
  group: 'tech-research',
  order: 1,
  title: 'World of ClaudeCraft:整體技術架構',
  summary: '開源瀏覽器 MMO(levy-street/world-of-claudecraft)的架構拆解:一套確定性 TypeScript 遊戲核心同時跑在權威伺服器、離線瀏覽器與無頭 RL 環境,畫面層只透過 IWorld 介面讀世界。',
  tags: ['外部專案', '架構', 'TypeScript', 'Three.js', 'MMO'],
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '記錄時間:2026-10-28。研究對象是 https://github.com/levy-street/world-of-claudecraft(v0.45.3,MIT),資料來源為 README、根目錄與各子目錄的 CLAUDE.md、package.json。目的是找可以借鏡到 tripace 的架構做法。',
      ],
    },
    {
      heading: '核心:One sim, three hosts',
      paragraphs: [
        '`src/sim/` 是確定性的遊戲核心,同一份程式碼不改一字跑在三個地方,行為必須完全一致。',
      ],
      table: {
        headers: ['宿主', '位置', '用途'],
        rows: [
          ['權威伺服器', '`server/`', '線上正式世界,Postgres 持久化,所有結果在這裡決定'],
          ['離線瀏覽器世界', '`src/main.ts`', '本機單人 Sim,開發與閱讀核心用'],
          ['無頭 RL 環境', '`headless/` + `python/`', 'Python 透過 Gymnasium 介面驅動真正的遊戲'],
        ],
      },
      bullets: [
        '確定性:固定 20 Hz tick(`DT = 1/20`),所有亂數走 `src/sim/rng.ts`,禁止 `Math.random`、`Date.now`、`performance.now`。',
        '`src/sim/` 不能有任何 DOM/瀏覽器/Three.js import,也不能反向 import render/ui/net。',
        '兩條規則都由 `tests/architecture.test.ts` 掃描每個 sim 檔案強制,不只是文件約定。',
      ],
    },
    {
      heading: 'IWorld:畫面與核心之間唯一的接口',
      bullets: [
        '`src/world_api/<domain>.ts` 依領域拆成多個 facet 介面,`src/world_api.ts` 只負責重新匯出。',
        '離線的 `Sim` 結構上直接滿足它;線上的 `ClientWorld` 透過鏡像伺服器快照來實作。',
        '`render/` 與 `ui/` 只能依賴 `IWorld`,所以同一套畫面同時支援離線與線上。',
        '新功能要加到對應 facet、兩個世界都實作,並同步更新 `tests/world_api_parity.test.ts` 釘住的成員清單。',
      ],
    },
    {
      heading: '網路模型:伺服器權威',
      bullets: [
        '客戶端以 20 Hz 透過 WebSocket(`ws`)送移動意圖與指令。',
        '伺服器 `GameServer`(`server/game.ts`)每 50ms 跑一次 Sim,回傳玩家周圍約 120 碼的興趣範圍快照與個人事件。',
        '戰鬥、掉寶、任務、經濟全部伺服器端決定,客戶端只負責呈現,每個收到的欄位都重新驗證。',
        'REST 走自製管線 `server/http/`:路由表 + 中介層洋蔥 + 每領域一個 `RouteDef` 模組,不能在 `main.ts` 寫 inline 路由。',
        '防護:入站洗頻閘門、出站背壓斷線(`ws_backpressure.ts`)、斷線保留期(`linkdead.ts`)、單 realm 人數上限。',
      ],
    },
    {
      heading: '前端',
      bullets: [
        '遊戲本體不用 UI 框架,依賴刻意保持很小;唯一例外是管理後台 `src/admin/` 用 Svelte 5,且不進遊戲 bundle。',
        'Three.js r185(版本鎖定且有 patch)+ postprocessing + n8ao;地形、水、天氣、城鎮與特效多在執行時由程式產生。',
        'Vite 多入口:遊戲、管理後台、地圖編輯器、wiki(`/wiki`,內容直接從 sim 產生,不會跟遊戲脫節)。',
        '畫質公平性規則:畫質選項只能拿掉裝飾,不能藏掉玩家要反應的資訊(減益、施法條、敵人位置)。',
      ],
    },
    {
      heading: '後端與資料層',
      bullets: [
        'esbuild 打包成 Node 伺服器,PostgreSQL 16(`pg`),`prom-client` 監控。',
        '每個領域拆成 `<domain>.ts`(邏輯)+ `<domain>_db.ts`(SQL);DDL 寫成 `<DOMAIN>_SCHEMA` 常數,開機時在 advisory lock 下由 `ensureSchema` 套用。',
        '大表新索引走 `concurrent_indexes.ts`(CREATE INDEX CONCURRENTLY);計時器有固定大小順序,由測試釘住;`retention_sweep.ts` 每晚清理無限成長的表。',
        '每個 realm 一個程序,共用同一個資料庫。',
        '外部整合:Discord 機器人(`bot/`)、Steam/Epic 成就同步、GitHub 貢獻者徽章、OAuth 唯讀 API、AWS SES 寄信。',
      ],
    },
    {
      heading: 'Web3(選用)與多平台',
      bullets: [
        'Solana 錢包連結(Reown AppKit、wallet-standard),$WOC 持有標記與每日獎勵;玩家拍賣市場 `woc_market*.ts` 已寫好但預設關閉,交易一致性設計極重(鎖順序、搬移物品前的錢包簽章、保證恰好交付一次)。',
        '桌面:Electron 43 + electron-builder + electron-updater(搭 Steam);行動:Capacitor 8(Android/iOS,含 Solana Mobile 版本),Capgo 熱更新。',
        '所有平台共用同一個瀏覽器客戶端,連同一個線上世界。',
      ],
    },
    {
      heading: '工具鏈與品質',
      bullets: [
        'TypeScript 7 原生版做型別檢查,另保留 TS 6 的 JS API 給 svelte-check;pnpm(且 patch Three.js)、Biome、Turbo。',
        'Vitest 4(happy-dom/jsdom)+ Playwright 瀏覽器回歸;合併前跑 `scripts/gate_select.mjs`(只跑相關測試)或完整 `npm run gate`。',
        '22 種語系:sim/server 只送 key,客戶端 `t()` 轉文字;貢獻者只寫英文。',
        'AI 協作寫進流程:每個子目錄都有 CLAUDE.md,`.claude/agents` 有架構、熱路徑、資料庫效能、遷移安全等審查子代理,加上 hooks(例如禁止手改自動產生的檔案)與 skills。',
      ],
    },
    {
      heading: '值得借鏡的設計',
      bullets: [
        '核心與畫面完全分離且確定,同一份程式可以當伺服器、單機版與 RL 環境。',
        '前端只透過單一介面(IWorld)存取世界,離線與線上共用整套畫面。',
        '主要規則用測試強制(禁止的 import、禁止的時間與亂數呼叫、兩個世界的介面一致、計時器大小順序),而不是靠文件約定。',
        '新功能一律放成獨立小模組,邏輯寫成不碰 IO 的純函式,IO 透過注入的依賴傳入,不接資料庫也能測。',
      ],
    },
  ],
}
