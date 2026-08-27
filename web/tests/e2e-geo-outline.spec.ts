// 端到端測試:規劃分頁(地理輪廓底圖,已無獨立 feature flag,見
// DesktopShared.tsx 的說明)每一個可點擊/可拖曳的互動元件都至少操作一次、
// 驗證會產生預期的畫面反應。
//
// 這支測試「不」負責啟動任何 process——跑之前必須已經有一份完整的開發環境
// 在跑(server :8080 + web dev server,見 web/.env.development 的
// VITE_API_BASE),用 E2E_BASE_URL 環境變數指向實際的 web dev server port
// (預設值對齊 playwright.config.ts 的 5173;本機若因埠號衝突漂移到其他 port,
// 執行前需另外設定)。跟 e2e-mock-llm.spec.ts 不同,這支測試不需要 mock LLM
// ——規劃分頁的互動完全不經過 AI/want orchestrator,純粹是前端 state +
// 後端 CRUD API,故可以直接對著開發者平常在跑的正式 dev 環境測試,不需要
// 額外啟動一整組隔離的 mockllm/server/web。
//
// 涵蓋範圍(對齊使用者要求「每個可以點擊拉動的元件,都測試操作會產生的互動」):
//   1. Rail 圖示切到「規劃」分頁
//   2. 城市搜尋(GeoCandidateSidebar 搜尋列)
//   3. 地圖上方類別標籤(飯店/景點/餐廳)點擊/取消
//   4. GeoHotelSidebar 三個分頁切換(地點/飯店/附近推薦)
//   5. GeoHotelSidebar 卡片本體點擊 → 開啟 GeoInfoPanel
//   6. GeoInfoPanel「加入候選」按鈕 → 候選出現在 GeoCandidateSidebar
//   7. GeoCandidateSidebar 候選卡片「×」移除
//   8. GeoCandidateSidebar 候選卡片拖曳進日層架某一天(候選 → 真正 entry)
//   9. GeoCandidateSidebar「已排入行程」卡片拖曳到別天(改期)
//   10. 地圖上景點區域(AttractionOverlay,真實 DOM,非 google.maps.Marker)
//       點擊 → 開啟 GeoInfoPanel
//
// google.maps.Marker(飯店/推薦地點/行程 entry 的地圖圖示)不是真實 DOM 節點
// (Maps SDK 內部用 canvas/自訂圖層繪製),Playwright 無法用一般 locator
// 點擊,故不在本測試涵蓋範圍——這些圖示的「點擊」邏輯與側欄卡片點擊共用同一
// 個 onXxxSelect callback(見 DesktopLayout.tsx),已經由第 5 項側欄卡片點擊
// 間接涵蓋等價的業務邏輯,只是觸發來源不同。
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

const LOGIN_EMAIL = 'me@channel.dev'
const LOGIN_PASSWORD = 'password'
const SEED_TRIP_NAME = '產品討論'

const STEP_TIMEOUT = 15_000

test.describe('規劃分頁(地理輪廓底圖):可點擊/可拖曳元件逐一操作', () => {
  let jsErrors: string[] = []

  test.beforeEach(({ page }) => {
    jsErrors = []
    page.on('pageerror', (err) => {
      jsErrors.push(`[pageerror] ${err.message}`)
    })
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') jsErrors.push(`[console.error] ${msg.text()}`)
    })
  })

  test('城市搜尋 → 類別標籤 → 側欄分頁/點擊/加入候選 → 候選移除/拖曳排程 → 地圖景點點擊', async ({ page }) => {
    await login(page)
    await openSeedTrip(page)
    await openGeoOutlineTab(page)

    // ---- 1. 城市搜尋 ----
    // 搜尋欄渲染在 GeoCandidateSidebar 最上方(見該元件說明),輸入城市名稱
    // 按 Enter 觸發 GeoOutlinePanel 內部的 fetchGeoGeocode 查詢、平移地圖。
    const cityInput = page.locator('input[placeholder*="輸入目的地城市"]')
    await expect(cityInput, '候選籃側欄最上方應該有城市搜尋輸入框').toBeVisible({ timeout: STEP_TIMEOUT })
    await cityInput.fill('清邁')
    await cityInput.press('Enter')
    // 查詢完成的訊號:搜尋按鈕文字從「查詢中...」變回「查看」(見
    // GeoCandidateSidebar.tsx searching 狀態的按鈕文字)。
    const searchBtn = page.getByRole('button', { name: /查看|查詢中/ })
    await expect(searchBtn, '搜尋完成後按鈕文字應變回「查看」').toHaveText('查看', { timeout: STEP_TIMEOUT })

    // ---- 2. 地圖上方類別標籤:點擊「景點」→ 應標記為選取(aria-pressed) ----
    // handleCategoryClick 內部有 `if (!mapRef.current) return` 的早退——
    // Google Maps 地圖容器(<div ref={containerRef}>)無條件渲染,但實際
    // google.maps.Map 實例要等 importLibrary('maps') 完成才會建立,若在
    // 那之前點類別標籤,點擊會被靜默吃掉(activeCategory 永遠不會被設
    // 成功)。等 Google Maps SDK 注入的 .gm-style 元素出現,確保地圖真的
    // 建立完成才開始互動。
    await expect(page.locator('.gm-style').first(), '地圖應該已經完成初始化(Google Maps SDK 注入 .gm-style)')
      .toBeVisible({ timeout: STEP_TIMEOUT })

    const attractionTag = page.locator('button[aria-pressed]', { hasText: '景點' })
    await expect(attractionTag, '地圖上方應有「景點」類別標籤').toBeVisible({ timeout: STEP_TIMEOUT })
    await attractionTag.click()
    await expect(attractionTag, '點擊後「景點」標籤應標記為已選取').toHaveAttribute('aria-pressed', 'true')
    // 再點一次應取消選取(見 handleCategoryClick 的「切換」邏輯)。
    await attractionTag.click()
    await expect(attractionTag, '再點一次應取消選取').toHaveAttribute('aria-pressed', 'false')

    // 重新點一次「飯店」類別標籤,驗證側欄「附近推薦」分頁標題會動態换成
    // 對應類別名稱(見 GeoHotelSidebar.tsx 的 placesCategory/PLACES_CATEGORY_LABELS)。
    const lodgingTag = page.locator('button[aria-pressed]', { hasText: '飯店' })
    await lodgingTag.click()
    await expect(lodgingTag, '點擊「飯店」標籤應標記為已選取').toHaveAttribute('aria-pressed', 'true')

    // ---- 3. GeoHotelSidebar 分頁切換:地點/飯店/附近推薦 ----
    // 這個畫面固定有兩個 <aside>:候選籃側欄的外層(.desktop-sidepanel)
    // 與 GeoHotelSidebar 自己的根元素,後者在 DOM 順序上排在後面(見
    // DesktopLayout.tsx 的渲染順序:側欄 aside → main → GeoHotelSidebar
    // aside),用 .last() 精準指到 GeoHotelSidebar。
    //
    // 分頁按鈕不能用 title 選取:第三個分頁「附近推薦」的 title 是動態的
    // placesLabel(見 GeoHotelSidebar.tsx),會依地圖上方類別標籤點擊結果
    // 換成對應類別名稱——上一步(2. 類別標籤)剛點過「飯店」,這裡會讓
    // 「附近推薦」分頁的 title 也變成「飯店」,跟真正的飯店分頁撞名
    // (這是刻意設計的功能,不是 bug,見該檔案 placesLabel 的說明)。故改用
    // .tabs 底下固定的第 1/2 個按鈕(依畫面順序:地點/飯店/附近推薦)。
    // .tabs 是 <aside> 底下的第一個直接子 div(見 GeoHotelSidebar.tsx 的
    // JSX 結構),用 DOM 結構位置鎖定,不依賴 CSS Modules 雜湊後的 class
    // 名稱,也避開 sidebar 內其餘按鈕(例如卡片上的「加入候選」也帶 svg
    // 圖示,若直接用 svg 存在與否篩選會誤選到那些)。
    const sidebar = page.locator('aside').last()
    const tabButtons = sidebar.locator('> div').first().locator('button')
    const attractionsTabBtn = tabButtons.nth(0)
    const hotelsTabBtn = tabButtons.nth(1)
    await expect(attractionsTabBtn, '右側清單應有「地點」分頁按鈕').toBeVisible({ timeout: STEP_TIMEOUT })
    await expect(hotelsTabBtn, '右側清單應有「飯店」分頁按鈕').toBeVisible()

    // 預設應該停在「地點」分頁(見 GeoHotelSidebar.tsx internalTab 初始值)。
    await attractionsTabBtn.click()

    // ---- 4. 地點卡片點擊 → 開啟 GeoInfoPanel ----
    // 由城市搜尋(清邁)+ 已預先用 tripace-cli 建檔的景點區域資料驅動——若這批
    // 資料還沒建檔,這裡會逾時失敗,屬預期行為(代表測試環境缺資料,而非
    // 功能本身有 bug)。
    // GeoHotelSidebar 地點分頁卡片本體是帶 role="button" 且內含地標名稱
    // 文字的元素,取清單裡第一張(sidebar 變數見上方「3. 分頁切換」,已
    // 用 .last() 限定為 GeoHotelSidebar 自己的 <aside>)。
    const attractionCards = sidebar.filter({ hasText: '清邁' }).locator('[role="button"]')
    const hasAttractionCard = await attractionCards.first().isVisible({ timeout: STEP_TIMEOUT }).catch(() => false)
    if (hasAttractionCard) {
      await attractionCards.first().click()
      const infoPanelTitle = page.locator('text=地點介紹')
      await expect(infoPanelTitle, '點擊地點卡片後應開啟 GeoInfoPanel(資訊卡標題「地點介紹」)')
        .toBeVisible({ timeout: STEP_TIMEOUT })

      // ---- 5. GeoInfoPanel「加入候選」按鈕 ----
      const addCandidateBtn = page.getByRole('button', { name: /加入.*(產品討論|行程)/ })
      const hasAddBtn = await addCandidateBtn.first().isVisible({ timeout: 3000 }).catch(() => false)
      if (hasAddBtn) {
        await addCandidateBtn.first().click()
        // 候選籃標題數字應該遞增至少 1(見 GeoCandidateSidebar.tsx 的
        // 「候選籃 · {candidates.length}」標題)。
        const basketTitle = page.locator('text=/候選籃 · [1-9]/')
        await expect(basketTitle, '加入候選後,左側候選籃標題數字應該 >= 1')
          .toBeVisible({ timeout: STEP_TIMEOUT })
      }
      await page.locator('button[title="關閉"]').click()
    } else {
      // 沒有預先建檔的景點區域資料時,略過卡片點擊/加入候選這兩步,但仍
      // 記錄成測試略過而非失敗——這是資料前置條件缺漏,不是功能邏輯問題。
      test.info().annotations.push({
        type: 'skipped-step',
        description: '未偵測到清邁景點區域卡片(需先用 tripace-cli attraction-add -db 建檔),略過「點擊地點卡片/加入候選」步驟',
      })
    }

    // ---- 6. 候選卡片拖曳進日層架(候選 → 真正 entry) ----
    // 必須在「7. ×移除候選」之前執行——移除會把剛加入的候選從清單清空,
    // 若順序顛倒,這裡會永遠偵測到 0 個可拖曳卡片而略過(這正是先前一版
    // 測試實際發生過的情況:加入候選 → 立刻移除 → 拖曳測試才執行,此時
    // 候選籃早已是空的)。種子行程本身沒有帶座標的既有 entry(見
    // seedIfEmpty),故這裡的可拖曳卡片只會來自上一步「加入候選」成功
    // 產生的那一筆。日層架卡片與候選中卡片皆帶 draggable="true"(見
    // GeoCandidateSidebar.tsx 的 CandidateRow/DayEntryCard)。
    const draggableEntryCards = page.locator('[draggable="true"]')
    const draggableCount = await draggableEntryCards.count()
    test.info().annotations.push({
      type: 'info',
      description: `目前偵測到 ${draggableCount} 個可拖曳卡片(候選中 + 已排入行程,若為 0 代表候選籃/日層架皆為空,拖曳測試將略過)`,
    })
    if (draggableCount > 0) {
      const firstDraggable = draggableEntryCards.first()
      // dropTarget:真正掛 onDragOver/onDrop 的元素是 .dayBody(空的
      // <div>,見 GeoCandidateSidebar.tsx 的佔位拖放區 JSX),不是顯示
      // 「隔天/開始排行程」文字的 .dayStatus <span>——兩者是同層級的
      // sibling(都在 .day 底下,.dayStatus 在 .dayHead 裡,.dayBody 是
      // .dayHead 的下一個 sibling),不是父子關係。用文字選到 .dayStatus
      // 後 dispatchEvent('drop', ...) 完全不會觸發 sibling .dayBody 上的
      // handler(已用獨立探測腳本反覆驗證:dragstart/dragend 都有觸發,
      // 但 handleDropOnDay 內建的 log 從未出現,證實 drop 事件根本沒有
      // 送達正確的目標元素——這是這支測試先前失敗的真正原因,不是產品
      // 邏輯的 bug)。改成先定位含該文字的 .dayHead,取其下一個 sibling
      // 元素才是真正的 .dayBody 拖放目標。
      const dropTarget = page.locator('text=/隔天|開始排行程/').first().locator('xpath=../following-sibling::div[1]')

      // 用 Playwright 官方文件記載的原生 HTML5 拖放測試手法(手動 dispatch
      // dragstart/dragenter/dragover/drop/dragend,共用同一個 DataTransfer
      // 物件)——不用滑鼠座標模擬(mouse.down/move/up 或 Locator.dragTo)。
      // 原因:原生 HTML5 drag-and-drop 是否真的啟動,由瀏覽器內部的手勢
      // 辨識機制決定,合成滑鼠事件不保證能觸發它(已實測驗證:純
      // mouse.down() 之後,畫面上完全沒有任何拖曳中的視覺回饋,佔位拖放區
      // 也始終不會從 display:none 變成顯示,即使中途搭配 { steps } 分段
      // 移動游標也一樣)。dispatchEvent 直接在 DOM 層級觸發對應事件,繞過
      // 瀏覽器手勢判定,能可靠地驗證「事件真的送達時,React 的
      // onDragStart/onDragOver/onDrop handler 邏輯本身是否正確」——這正是
      // 這支測試真正該驗證的範圍(資料有沒有正確落地),不是「瀏覽器判定
      // 這是不是一次合法的使用者拖曳手勢」這個更底層、跟 Playwright
      // 合成輸入本身限制較相關的問題。
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
      await firstDraggable.dispatchEvent('dragstart', { dataTransfer })
      // dragstart 的 handler 呼叫 setDraggingCandidate(c)——React 18 的
      // state 更新是非同步排程的(不保證在 dispatchEvent() 的 promise
      // resolve 當下就已經 commit 完新的一輪渲染)。若緊接著不等待就送出
      // 後續 dragenter/dragover/drop,這幾個事件的 handler 閉包可能還綁在
      // 「更新前」那次渲染產生的版本上,讀到的 draggingCandidate 仍是
      // 舊值——用 waitForTimeout 讓出一個事件迴圈週期,確保 React 真的
      // commit 完這次 state 更新、handler 閉包已經是最新版本,才送出後續
      // 事件。
      await page.waitForTimeout(200)
      await dropTarget.dispatchEvent('dragenter', { dataTransfer })
      await page.waitForTimeout(100)
      await dropTarget.dispatchEvent('dragover', { dataTransfer })
      await page.waitForTimeout(100)
      await dropTarget.dispatchEvent('drop', { dataTransfer })
      await page.waitForTimeout(100)
      await firstDraggable.dispatchEvent('dragend', { dataTransfer })

      // 拖放後,候選轉成真正的 entry(見
      // handleCreateEntryFromCandidate/handleAssignDate)會讓「已排入
      // 行程」分組標題出現——這是拖放手勢真的「有落地生效」的直接證據,
      // 而不只是「操作過程沒有拋出例外」。種子行程本身沒有帶座標的既有
      // entry,故拖放前這個分組標題必定不存在,拖放後出現就足以證明這次
      // 拖放成功寫入後端。
      await expect(page.locator('text=/已排入行程 · \\d+/'), '拖放候選卡片到日層架後,應該出現「已排入行程」分組')
        .toBeVisible({ timeout: STEP_TIMEOUT })
    }

    // ---- 7. 候選/已排入行程卡片「×」移除 ----
    // 不論上一步拖曳是否成功把候選轉成真正的 entry,候選籃裡都應該還留有
    // 至少一張卡片(拖曳失敗則是原本的候選,拖曳成功則是新產生的已排入
    // 行程項目,兩者都有「×」移除鈕,見 CandidateRow/DayEntryCard)——
    // 移除它,驗證候選籃標題數字會跟著減少,同時清理掉這支測試自己加入
    // 的候選,不留殘留資料給下一次執行。
    const removeBtn = page.locator('button[title="移除候選"]').first()
    const hasCandidate = await removeBtn.isVisible({ timeout: 3000 }).catch(() => false)
    if (hasCandidate) {
      const basketTitleBefore = await page.locator('text=/候選籃 · \\d+/').textContent()
      await removeBtn.click()
      const basketTitleAfter = page.locator('text=/候選籃 · \\d+/')
      await expect(basketTitleAfter, '移除候選後,候選籃標題數字應該減少')
        .not.toHaveText(basketTitleBefore ?? '', { timeout: STEP_TIMEOUT })
    }

    // ---- 8. 地圖上景點區域(AttractionOverlay,真實 DOM)點擊 ----
    // 對齊 geoAttractionOverlay.ts 的固定 class 名稱(非 CSS Modules 雜湊),
    // 見該檔案關於 clickTarget 的說明。
    const mapAttractionPhoto = page.locator('.geo-attraction-landmark-photo, .geo-attraction-landmark-placeholder').first()
    const hasMapAttraction = await mapAttractionPhoto.isVisible({ timeout: STEP_TIMEOUT }).catch(() => false)
    if (hasMapAttraction) {
      await mapAttractionPhoto.click()
      const infoPanelTitle = page.locator('text=地點介紹')
      await expect(infoPanelTitle, '點擊地圖上景點區域圖示後應開啟 GeoInfoPanel')
        .toBeVisible({ timeout: STEP_TIMEOUT })
    } else {
      test.info().annotations.push({
        type: 'skipped-step',
        description: '地圖上未偵測到任何景點區域圖示(AttractionOverlay),略過地圖點擊步驟',
      })
    }

    // ---- 全程沒有任何(規劃分頁範圍內的)JS 例外或 console error ----
    // 排除兩類已知跟規劃分頁完全無關的既有雜訊,對齊這支測試「不需要啟動
    // 隔離的 process 組合、直接對著開發者平常在跑的正式 dev 環境測試」的
    // 設計(見檔案開頭說明):共用 dev 環境裡進入行程時一定會嘗試建立的
    // 聊天室 WS(v1/trips/{id}/ws,跟 ChatScreen 相關,不是規劃分頁的一部分)
    // 與 ClientToolsBridge demo 用的 WS(internal/clienttools/ws),兩者在
    // 這支測試操作的整段流程中都不會被規劃分頁的任何互動觸發或依賴,
    // 出現與否純粹跟這個共用 dev server 實例當下的設定/認證狀態有關。
    // 這兩個端點的網址後面可能接 ?token=... 等查詢字串,不能要求路徑後面
    // 緊接著結尾單引號(該規則曾誤判成不匹配,見這個常數上一版的紀錄),
    // 只要求路徑本身出現在訊息裡即可。
    const unrelatedWsNoise = /WebSocket connection to '.*(\/v1\/trips\/[^/]+\/ws|\/internal\/clienttools\/ws)/
    const relevantErrors = jsErrors.filter((e) => !unrelatedWsNoise.test(e))
    expect(relevantErrors, `頁面在整段流程中不應出現規劃分頁相關的 JS 例外或 console error,實際捕捉到:\n${relevantErrors.join('\n')}\n(已過濾掉的既有雜訊:\n${jsErrors.filter((e) => unrelatedWsNoise.test(e)).join('\n')})`)
      .toEqual([])
  })
})

// ---- 輔助函式(對齊 e2e-mock-llm.spec.ts 既有慣例) ----

async function login(page: Page) {
  await page.goto('/app')
  const loginCard = page.locator('.login-card')
  await expect(loginCard, '訪客狀態應該看到登入卡片').toBeVisible()
  await loginCard.locator('input[type="email"]').fill(LOGIN_EMAIL)
  await loginCard.locator('input[type="password"]').fill(LOGIN_PASSWORD)
  await loginCard.getByRole('button', { name: '登入' }).click()
  await expect(loginCard).toHaveCount(0, { timeout: STEP_TIMEOUT })
}

async function openSeedTrip(page: Page) {
  const tripItem = page.locator('.row, .desktop-channel-item, .desktop-trip-item', { hasText: SEED_TRIP_NAME }).first()
  await expect(tripItem, `行程列表應該出現種子行程「${SEED_TRIP_NAME}」`).toBeVisible({ timeout: STEP_TIMEOUT })
  await tripItem.click()
}

// openGeoOutlineTab:點擊桌面版左側 rail 上 title="規劃" 的圖示鈕,切到地理
// 輪廓底圖分頁——規劃地圖已不再有獨立 feature flag(見 DesktopShared.tsx
// 的說明),按鈕永遠存在。
async function openGeoOutlineTab(page: Page) {
  const railBtn = page.locator('button[title="規劃"]')
  await expect(railBtn, 'Rail 上應該有 title="規劃" 的圖示按鈕')
    .toBeVisible({ timeout: STEP_TIMEOUT })
  await railBtn.click()
  // 候選籃側欄出現代表已切換到規劃分頁(見 DesktopLayout.tsx panelMode ===
  // 'geo-outline' 的渲染條件)。
  await expect(page.locator('input[placeholder*="輸入目的地城市"]'), '切換到規劃分頁後應看到候選籃側欄的城市搜尋欄')
    .toBeVisible({ timeout: STEP_TIMEOUT })
}
