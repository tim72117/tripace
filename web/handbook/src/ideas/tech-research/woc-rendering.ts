import type { IdeaDoc } from '../types'

export const WOC_RENDERING: IdeaDoc = {
  id: 'research-woc-rendering',
  group: 'tech-research',
  order: 2,
  title: 'World of ClaudeCraft:前端畫面渲染',
  summary: '`src/render/` 的 Three.js 渲染器拆解:只讀不寫的定位、「純邏輯 + 薄繪製層」的模組寫法、gfx.ts 畫質分級、後製鏈與降級、避免執行中編譯 shader 的卡頓防治,以及每幀效能紀律。',
  tags: ['外部專案', '渲染', 'Three.js', 'WebGL', '效能'],
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '記錄時間:2026-10-28。資料來源為 `src/render/CLAUDE.md` 與 `src/render/post.ts` 檔頭註解。整體架構見同分類〈整體技術架構〉。',
      ],
    },
    {
      heading: '定位:只畫、不改',
      bullets: [
        '每一幀把 `IWorld` 的狀態畫成畫面,`Renderer` 建構子只接收 `IWorld`,不能改任何遊戲資料。',
        '畫面需要新資料時,先擴充 `IWorld`,不能直接伸手去讀 `Sim` 或 `ClientWorld`。',
        '硬規則:地形高度一律呼叫 sim 的 `terrainHeight` / `groundHeight`,渲染端不自己算,否則畫面會跟碰撞判定脫節。',
      ],
    },
    {
      heading: '模組結構',
      paragraphs: [
        '`renderer.ts` 是統籌者(scene、camera、燈光、`views: Map<id, EntityView>`、每幀入口 `sync()`),其他功能全部是旁邊的獨立模組。`renderer.ts` 不准再長大,對外功能拆成門面物件(例如 `renderer.picking`、`renderer.editor`)。',
      ],
      table: {
        headers: ['類別', '代表模組'],
        rows: [
          ['世界子系統(`build*()` 回傳 `*View`)', 'terrain(分塊 LOD + PBR splat)、props/foliage/dungeon(GLB 實例化或合併)、water + ocean/(FFT 海面)、sky'],
          ['每幀特效', 'vfx(粒子池)、weather、character_effects、ability_vfx/'],
          ['名牌', 'nameplate_view(純邏輯)+ nameplate_painter(投影、DOM、i18n)'],
          ['鏡頭', 'camera_boom/feel/director_core、interior_camera(室內限制)'],
          ['效能調節', 'render_budget(每幀預算)、crowd_lod(角色 LOD)、far_lod_latch(LOD 切換防閃爍)'],
          ['串流與常駐', 'zone_streaming、chunk_residency_core、assets/residency_budget'],
          ['後製', 'post.ts'],
        ],
      },
    },
    {
      heading: '核心寫法:純邏輯 + 薄繪製層',
      bullets: [
        '每幀的判斷(顯示與否、錨點、插值、LOD 級別)寫成 `*_core.ts` / `*_view.ts`,不碰 Three.js、DOM、i18n,結果確定,直接用 Vitest 測、不需要瀏覽器。',
        '碰 Three.js 與 DOM 的部分是一層很薄的繪製層,由 renderer 呼叫。',
        '這類模組必須登記到 `RENDER_PURE_CORES`;`tests/architecture.test.ts` 掃描所有 `*_core` / `*_view`,沒登記或用了不該用的 import 就讓 CI 失敗。',
        '範例:`nameplate_view.ts` + `nameplate_painter.ts`;純邏輯半邊連記憶體都不配置(`nameplatePlanInto` 寫進呼叫端傳入的物件)。',
      ],
    },
    {
      heading: 'gfx.ts:共用核心',
      bullets: [
        '畫質分級 `GFX`(low 到 insane),等級單調遞增,判斷用 `gfxTierAtLeast`,不比對字串;所有跟畫質有關的參數集中在這裡。建好 `WebGLRenderer` 後立刻 `initGfxTier`,偵測到軟體繪圖預設降成 low。',
        '材質工廠 `surfaceMat()`:依顏色/貼圖/旗標去重,讓上百個物件共用少數 shader 程式;low 畫質自動換成 Lambert。',
        '單一時鐘 `sharedUniforms.uTime` 給所有 `onBeforeCompile` shader(風、水、雜訊顆粒),`sync()` 每幀更新一次;全場景只有一個太陽方向(`SUN_DIR`)。',
        '跨材質 shader 服務:例如區域霧色場只有一份 uniform,地形、遠景、水面、天空共用,遠方每個區域都帶自己的大氣色調,交界不會出現一圈接縫。',
      ],
    },
    {
      heading: '後製鏈與降級',
      paragraphs: [
        'N8AO(SSAO;high 半解析度、ultra 以上全解析度)→ UnrealBloom → OutputGradePass(ACES tonemap + sRGB + 調色/飽和度/暗角/雜訊)→ ScreenFx → SMAA(high 以上)。medium 只跑 RenderPass + OutputGradePass,抗鋸齒改用融進調色 pass 的 FXAA。',
      ],
      bullets: [
        '效能吃緊時 `post_shed` 一級一級降:SMAA 換成 FXAA → bloom 減少再關閉 → N8AO 變成直接通過;每一級要用的 shader 都事先編譯好,降級當下不會卡頓。',
        '不能隨便升級 Three.js:很多 shader 直接 patch r185 的 shader chunk,KTX2 轉碼器也經過 patch(拿掉 eval 才能通過 Electron 的 CSP)。',
      ],
    },
    {
      heading: 'GPU 卡頓防治(文件篇幅最多的部分)',
      paragraphs: ['目標:進入世界後,不在畫面播放中途才第一次編譯 shader。'],
      bullets: [
        '進入世界前的預熱是一份清單,新的重量級子系統要加成清單項目;手機級 WebKit 只跑精簡清單(iOS 會因主執行緒卡太久殺掉程序,GPU 記憶體也有上限),來不及的拆成小單位在背景補做。',
        '第一次出現的材質一定要有預熱位置,或透過 `compileGate` / `attachSceneGroupGated` 先編好再顯示;禁止開機後直接 `scene.add` 一組帶新材質的物件。',
        '顯示中的材質要換 shader(貼圖槽、透明度、defines 等改變)時,先放替身,等新程式編好再換;任何時候都不能讓實體沒有畫面表示。',
        '執行中不能增減燈光(會讓所有材質重編),禁止 transmission 材質(多一次場景繪製),也不能另開新佇列。',
        '驗收:`?perf` 加 `perfStats().gpuPrep` 的 `live-program` 計數。',
        'WebGL context 管理:重建時重用同一個 context、`pagehide` 時主動釋放(瀏覽器同時只允許約 16 個)、註冊 context 遺失後的復原流程。',
      ],
    },
    {
      heading: '每幀效能紀律',
      bullets: [
        '熱路徑每幀不 `new THREE.*`,重用 scratch 向量;重複物件用實例化,一次性物件依材質合併。',
        '遍歷所有實體只在有變動時做(看 `entityRosterVersion`),平常每隔 N 幀補掃一次。',
        'LOD 切換有距離緩衝、停留時間與移動寬限,避免物件在邊界閃爍;世界王用多角度 atlas 做看板替身(impostor),整個區域外都看得到。',
        '被隱藏的子樹不做任何工作,而且要檢查切換真的發生了,不能只看意圖旗標。',
        '地面特效有固定繪製分層(ground → player → encounter → reticle),確保王的預警範圍永遠畫在玩家技能特效上面。',
      ],
    },
    {
      heading: '對 tripace 的參考',
      bullets: [
        '「純邏輯 + 薄繪製層」加上 architecture test 強制:地圖繪製層(`planning/map/draw`)可以把每幀的判斷抽成不碰 DOM 的 core,用 Node 測試鎖住。',
        '共用材質/樣式工廠去重、單一時鐘與單一光源的概念,對應到地圖圖層可以是共用的樣式工廠與單一動畫時鐘。',
      ],
    },
  ],
}
