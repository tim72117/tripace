// 端到端測試:ScrollTimeline(捲動時間軸 + 嵌入式地圖面板共用元件)的
// 地圖面板「展開後置中」與「捲動到底時與時間軸同步」這兩個視覺行為。
//
// 這兩個行為的根因跟修法(見 ScrollTimeline.module.css 對應區塊的完整
// 說明)都曾經連續好幾輪被憑 CSS 規範文字理解做出的「看起來合理」的修法
// 證明是錯的,必須用 Playwright 實測 getBoundingClientRect() 才量得出來
// ——肉眼看截圖/純閱讀 CSS 都無法可靠判斷。這支測試把當時手動驗證用的
// 斷言固化下來,之後任何人改動這個檔案如果不小心破壞這兩個行為,能直接
// 被測試抓到,不需要每次都重新手動截圖/量測。
//
// 刻意不用 screenshot diff(toHaveScreenshot 像素比對):這個元件的視覺
// 細節(圓角/陰影/留白/配色)還在持續微調中,每次微調都會讓像素比對失敗、
// 需要重新核准基準圖,維護成本高,而且比對失敗時只看得到一張模糊的差異
// 熱區圖,看不出是哪個具體數字壞了。改用幾何關係斷言(留白是否對稱、是否
// 探出視窗、兩個元素的 y 座標是否同步)——這些才是這兩個行為真正要保證
// 的性質,跟像素级的視覺細節無關,也不會因為微調配色/陰影而跟著變動。
//
// 這支測試「不」負責啟動任何 process,跑之前必須已經有開發環境在跑(web
// dev server),用 E2E_BASE_URL 環境變數指向實際 port(預設值對齊
// playwright.config.ts 的 5173),對齊 e2e-geo-outline.spec.ts 的既有慣例
// ——赤崁頁(/tainan-chikan)的互動完全不經過 AI/後端資料,不需要登入/
// 種子資料,可以直接對著開發環境測試。
import { test, expect, type Page } from '@playwright/test'

const PAGE_PATH = '/tainan-chikan'
const STEP_TIMEOUT = 15_000

// 設計規格(使用者 2026-10 第八輪確認,推翻第七輪「地圖獨立置中、時間軸
// 疊在裡面但不參與置中計算」的方向):
//   1. 時間軸的位置是固定錨點,不受地圖面板影響——它的水平位置由
//      .layout 的 grid 欄位決定,要配合內文排版,不能為了置中地圖反過來
//      移動時間軸。
//   2. 地圖面板的「左緣」才是跟著時間軸走的:左緣 = 時間軸左緣 - 固定
//      間隙,剛好包覆時間軸,留一點呼吸空間,不多不少。
//   3. 地圖面板要整體左右對稱置中於視窗,但不是「地圖寬度先定出一個
//      固定比例」——寬度是左緣決定之後,為了達成置中反推出來的結果:
//      右緣 = 視窗寬度 - 左緣(讓左緣到視窗中心的距離 = 右緣到視窗中心
//      的距離),寬度 = 右緣 - 左緣。
// 這跟第六輪(地圖寬度先取剩餘空間的固定比例)、第七輪(地圖自己先置中,
// 時間軸單純疊上去不影響計算)都不同:這次的因果關係是「時間軸位置 →
// 決定地圖左緣 → 決定地圖右緣/寬度」,時間軸才是因,地圖尺寸是果。
const TIMELINE_GAP_MIN_PX = 4
const TIMELINE_GAP_MAX_PX = 32

/** 捲到第一個 stop 附近,讓 .mapPanelWrap 進入觸頂(sticky)狀態,
 *  再點擊「地圖」展開面板。對齊手動驗證時使用的流程。 */
async function openMapPanel(page: Page) {
  await page.goto(PAGE_PATH, { waitUntil: 'domcontentloaded' })
  // 等頁面實際渲染出時間軸/地圖面板的 DOM(ScrollTimeline 是客戶端渲染,
  // domcontentloaded 當下可能還沒 mount 完成)。注意這裡只能斷言「存在
  // 於 DOM」(toBeAttached),不能斷言 toBeVisible——面板展開前的預設
  // 狀態是 .mapPanelHidden(visibility:hidden + aria-hidden="true",見
  // ScrollTimeline.module.css 該 class 的說明),這是正常的初始狀態,
  // 不是渲染失敗。
  await expect(page.locator('[class*="_mapPanelWrap_"]').first(), '頁面應該已經渲染出地圖面板容器')
    .toBeAttached({ timeout: STEP_TIMEOUT })
  await page.evaluate(() => window.scrollTo(0, 900))
  // 捲動後給 sticky 定位與可能的版面重排一點時間穩定下來。
  await page.waitForTimeout(300)

  // 用 getByText 找「地圖」字樣時會連同隱藏的「地圖資料」按鈕一起比對到
  // (.first() 抓到的不保證是可見、可點的那個),改成限定在 <button> 角色
  // 內查找,對齊 ModeGroup 的實際 DOM 結構(見 ScrollTimeline.tsx)。
  const mapToggle = page.locator('button', { hasText: '地圖' }).first()
  await expect(mapToggle, '觸頂區域應該有「地圖」展開按鈕').toBeVisible({ timeout: STEP_TIMEOUT })
  await mapToggle.click()

  // 面板加上 .mapPanelOpen 的同時有展開動畫(.mapPanelGrowing,見
  // ScrollTimeline.module.css),量測前等動畫跑完,避免抓到動畫過程中的
  // 中間尺寸。
  await page.waitForTimeout(700)
}

async function measureMapPanel(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('[class*="_mapPanelWrap_"]')
    const timeline = document.querySelector('[class*="_timeline_"]')
    if (!wrap || !timeline) return null
    const w = wrap.getBoundingClientRect()
    const t = timeline.getBoundingClientRect()
    return {
      wrap: { x: w.x, width: w.width, right: w.right },
      timeline: { x: t.x, right: t.right, top: t.top, bottom: t.bottom },
    }
  })
}

test.describe('ScrollTimeline:地圖面板左緣包覆時間軸,右緣反推置中於視窗', () => {
  // 觸頂區間(641~960px)跟桌面寬版(>960px)歷史上曾經是兩套不同的 CSS
  // 邏輯、各自獨立壞過,這裡刻意涵蓋兩側加上手機斷點邊界,確保統一後的
  // 單一算式在整個區間都成立,不是只在某幾個湊巧的寬度下碰巧對稱。
  for (const vw of [700, 800, 900, 960, 1100, 1280, 1600]) {
    test(`視窗寬度 ${vw}px:地圖左緣應包覆時間軸、地圖整體應對稱置中於視窗`, async ({ page }) => {
      await page.setViewportSize({ width: vw, height: 900 })
      await openMapPanel(page)

      const rect = await measureMapPanel(page)
      expect(rect, '應該能找到 .mapPanelWrap 與 .timeline 元素').not.toBeNull()
      const { wrap, timeline } = rect!

      expect(wrap.x, '地圖面板左緣不應探出視窗左側').toBeGreaterThanOrEqual(-1)
      expect(wrap.right, '地圖面板右緣不應探出視窗右側').toBeLessThanOrEqual(vw + 1)

      // 規則 1(因):地圖左緣要剛好包覆時間軸、留固定呼吸間隙——不是貼齊
      // 時間軸左緣(間隙=0,太擠),也不是跟時間軸距離過遠(間隙過大,
      // 看起來像在地圖外面、沒有「包覆」的視覺效果)。時間軸左緣是這裡
      // 的輸入值(由 .layout 的 grid 欄位決定,配合內文排版,不受地圖
      // 面板影響),地圖左緣相對它的距離才是要驗證的量。
      const leftInset = timeline.x - wrap.x
      expect(
        leftInset,
        `地圖左緣應該在時間軸左緣外側留間隙,不能貼齊或蓋到時間軸左側(timeline.x=${timeline.x}, wrap.x=${wrap.x})`,
      ).toBeGreaterThanOrEqual(TIMELINE_GAP_MIN_PX)
      expect(
        leftInset,
        `地圖左緣跟時間軸左緣的間隙不應過大,否則視覺上像是分離、不是「包覆」(實測 ${leftInset.toFixed(1)}px)`,
      ).toBeLessThanOrEqual(TIMELINE_GAP_MAX_PX)

      // 規則 2(果):地圖整體(左緣已由時間軸決定)要左右對稱置中於整個
      // 視窗——寬度不是先定出一個固定比例,是左緣定案後,為了置中反推出
      // 右緣/寬度的結果。
      const leftGap = wrap.x
      const rightGap = vw - wrap.right
      expect(
        Math.abs(leftGap - rightGap),
        `地圖面板應整體左右對稱置中於視窗(leftGap=${leftGap.toFixed(1)}, rightGap=${rightGap.toFixed(1)})`,
      ).toBeLessThan(2)

      expect(wrap.width, '地圖面板寬度應為正值').toBeGreaterThan(0)
    })
  }
})

test.describe('ScrollTimeline:地圖面板展開後,時間軸應完全包覆在地圖左側邊框內', () => {
  // 使用者 2026-10 第八輪確認的設計是:時間軸位置固定(配合內文排版,
  // 不受地圖面板影響),地圖面板的左緣要「剛好包覆時間軸」,四周(左/
  // 上/下)都要留呼吸間隙——不是鬆散的「只要有交集就算疊在裡面」,而是
  // 時間軸的矩形範圍要「完全落在」地圖矩形內側、且離地圖邊框有一段
  // 距離,不貼邊也不超出。這裡改用三種互補的檢查方式:
  //   1. z-index 疊層順序——CSS 層級保證「理論上」疊在上面
  //   2. 完全包覆 + 間隙——.timeline 的矩形四個邊都要落在 .mapPanel
  //      矩形內側,且左/上/下三邊的間隙要落在合理區間(TIMELINE_GAP_
  //      MIN_PX ~ TIMELINE_GAP_MAX_PX),不是「隨便沾到邊就算數」
  //   3. 命中測試(document.elementFromPoint)——最貼近使用者體感:
  //      滑鼠點在時間軸縮圖座標上,實際上真的點得到時間軸,不會被地圖
  //      蓋住點不到
  test('展開後 .timeline 的 z-index 應高於地圖面板,視覺上疊在地圖之上', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openMapPanel(page)

    const zIndexes = await page.evaluate(() => {
      const timeline = document.querySelector('[class*="_timeline_"]')
      const wrap = document.querySelector('[class*="_mapPanelWrap_"]')
      if (!timeline || !wrap) return null
      return {
        timeline: Number(getComputedStyle(timeline).zIndex),
        wrap: Number(getComputedStyle(wrap).zIndex),
      }
    })

    expect(zIndexes, '應該能找到時間軸與地圖面板元素').not.toBeNull()
    expect(zIndexes!.timeline, '.timeline 的 z-index 應高於 .mapPanelWrap,確保視覺上疊在地圖之上')
      .toBeGreaterThan(zIndexes!.wrap)
  })

  test('展開後 .timelineTrack 應完全包覆在地圖面板左側邊框內,四周留有合理間隙', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openMapPanel(page)

    const rects = await page.evaluate(() => {
      // 用 .timelineTrack(圓形縮圖+連接線段的實際可見範圍)而不是
      // .timeline(外殼容器)——.timeline 本身是 position:sticky +
      // height:100vh 的滿版容器,用來撐出「可以黏住捲動多久」的空間,
      // 實際視覺內容(時間軸縮圖)只佔其中一小段、由 padding-top 往下
      // 推,左右對齊但上下範圍小很多(實測 900px 視窗下 .timeline 高
      // 900px、.timelineTrack 只有 236px)。拿 .timeline 的上下邊界
      // 來跟地圖比對「有沒有包覆」沒有意義——.timeline 幾乎必然探出
      // 地圖的 260px 高度,但那不代表視覺上「時間軸縮圖」真的露出來。
      const track = document.querySelector('[class*="_timelineTrack_"]')
      // CSS Modules 的 class 名稱是「本身的 hash class」加上可能疊加的
      // 狀態 class(例如 "_mapPanel_xxx _mapPanelGrowing_xxx"),用
      // querySelector 屬性選擇器排除法(:not([class*="Wrap"]) 等)在這裡
      // 容易選錯或選不到,因為子字串比對規則一多就很難兜對。改成直接在
      // JS 裡找出 class 列表中,第一段(本身的 hash class)精確符合
      // "_mapPanel_<hash>"形式(不含 Wrap/Body/Inner/Close/Open/Growing
      // 等字尾)的那個元素,比較不容易因為命名細節而選錯。
      const panel = Array.from(document.querySelectorAll('[class*="mapPanel"]')).find((el) => {
        const first = (el.getAttribute('class') || '').split(' ')[0]
        return /^_mapPanel_/.test(first)
      })
      if (!track || !panel) return null
      return { track: track.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON() }
    })

    expect(rects, '應該能找到時間軸縮圖與地圖面板本體元素').not.toBeNull()
    const { track: t, panel: p } = rects!

    // 完全包覆:時間軸縮圖矩形的四個邊界都必須落在地圖矩形內側,不能
    // 探出地圖範圍——這是「包覆」跟單純「有交集」的關鍵差異,單純有
    // 交集允許時間軸一半露在地圖外面,包覆不行。
    expect(t.left, `時間軸縮圖左緣不應探出地圖面板左側(track.left=${t.left}, panel.left=${p.left})`)
      .toBeGreaterThanOrEqual(p.left)
    expect(t.right, `時間軸縮圖右緣不應探出地圖面板右側(track.right=${t.right}, panel.right=${p.right})`)
      .toBeLessThanOrEqual(p.right)
    expect(t.top, `時間軸縮圖上緣不應探出地圖面板上側(track.top=${t.top}, panel.top=${p.top})`)
      .toBeGreaterThanOrEqual(p.top)
    expect(t.bottom, `時間軸縮圖下緣不應探出地圖面板下側(track.bottom=${t.bottom}, panel.bottom=${p.bottom})`)
      .toBeLessThanOrEqual(p.bottom)

    // 左/上/下三邊的間隙要落在合理區間(見檔案開頭 TIMELINE_GAP_MIN_PX/
    // MAX_PX 的完整說明)——右側是地圖內容延伸的方向,不要求留間隙。
    const leftInset = t.left - p.left
    const topInset = t.top - p.top
    const bottomInset = p.bottom - t.bottom

    for (const [label, inset] of [
      ['左', leftInset],
      ['上', topInset],
      ['下', bottomInset],
    ] as const) {
      expect(inset, `時間軸與地圖面板${label}側邊框的間隙不應小於 ${TIMELINE_GAP_MIN_PX}px(實測 ${inset.toFixed(1)}px,太貼邊)`)
        .toBeGreaterThanOrEqual(TIMELINE_GAP_MIN_PX)
      expect(inset, `時間軸與地圖面板${label}側邊框的間隙不應大於 ${TIMELINE_GAP_MAX_PX}px(實測 ${inset.toFixed(1)}px,視覺上像分離)`)
        .toBeLessThanOrEqual(TIMELINE_GAP_MAX_PX)
    }
  })

  test('展開後點擊時間軸縮圖座標,應命中時間軸元素而非被地圖蓋住', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openMapPanel(page)

    const hit = await page.evaluate(() => {
      const timeline = document.querySelector('[class*="_timeline_"]')
      if (!timeline) return null
      const r = timeline.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const el = document.elementFromPoint(x, y)
      // 往上找到最近的、class 名稱包含 timeline 相關字樣的祖先,藉此判斷
      // 命中的元素是否真的屬於時間軸這一支 DOM 子樹,而不是蓋在上面的
      // 地圖面板。
      let node: Element | null = el
      let withinTimeline = false
      while (node) {
        const cls = node.getAttribute('class') || ''
        if (/_timeline_|_dot_|_ghostDot_/.test(cls)) {
          withinTimeline = true
          break
        }
        node = node.parentElement
      }
      return { tag: el?.tagName, cls: el?.getAttribute('class'), withinTimeline }
    })

    expect(hit, '時間軸範圍內應該能找到可命中的元素').not.toBeNull()
    expect(
      hit!.withinTimeline,
      `點擊時間軸縮圖座標應命中時間軸子樹內的元素,實際命中 <${hit!.tag} class="${hit!.cls}">(可能被地圖面板蓋住)`,
    ).toBe(true)
  })
})

test.describe('ScrollTimeline:捲動到底時時間軸與地圖面板不應分離', () => {
  test('從頁首捲到頁尾,.timeline 與 .mapPanelWrap 的垂直位置應全程同步', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[class*="_timeline_"]').first(), '頁面應該已經渲染出時間軸')
      .toBeVisible({ timeout: STEP_TIMEOUT })

    const docHeight = await page.evaluate(() => document.body.scrollHeight)
    const STEPS = 12
    let maxDiff = 0

    for (let i = 0; i <= STEPS; i += 1) {
      const scrollY = Math.round((docHeight - 800) * (i / STEPS))
      await page.evaluate((y) => window.scrollTo(0, y), scrollY)
      await page.waitForTimeout(150)

      const diff = await page.evaluate(() => {
        const timeline = document.querySelector('[class*="_timeline_"]')
        const wrap = document.querySelector('[class*="_mapPanelWrap_"]')
        if (!timeline || !wrap) return null
        return Math.abs(timeline.getBoundingClientRect().y - wrap.getBoundingClientRect().y)
      })

      expect(diff, `scrollY=${scrollY} 時應能找到時間軸與地圖面板元素`).not.toBeNull()
      maxDiff = Math.max(maxDiff, diff!)
    }

    // 修正前(.mapPanelWrap 高度 260px 左右,跟 .timeline 的 100vh 不同)
    // 捲到底時兩者會分離,實測過最大分離量達 444px(1280×800 視窗)。
    // 兩者 height 統一為 100vh 後,sticky 元素被 containing block 底部
    // 推走的時機點理論上應該完全一致,全程 diff 應為 0,這裡放寬到 1px
    // 容許子像素捨入誤差。
    expect(maxDiff, `捲動全程時間軸與地圖面板的垂直位置最大分離量應接近 0,實測 ${maxDiff.toFixed(1)}px`)
      .toBeLessThan(1.5)
  })
})
