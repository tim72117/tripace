// attractionPool.ts — 給 onagent「查詢景點」「新增景點」兩個工具使用的
// 假景點池,純前端固定資料,不打任何後端 API。這是使用者明確要求的
// 「前端先做一個假的景點池讓 agent 可以查詢」——跟 plan_sim_ws.go 那套
// 既有的模擬 WS 腳本是完全獨立的兩條路徑(見 AIPlanTimelinePage.tsx 頂部
// 對這兩條路徑分工的說明),互不影響:腳本負責「自動演示 AI 逐步排行程」
// 的既有展示,這份池子負責「使用者在對話框打字,onagent 呼叫工具查詢/
// 新增景點」的新互動,兩者各自獨立運作,不共用同一個 WebSocket 連線或
// action 訊息格式。
//
// 欄位形狀刻意對齊 PlanAction 的 add_stop 分支需要的欄位(time/duration/
// kind/name/desc/thumbBg/thumbIcon/tags/lat/lng)——查到/新增的景點要能
// 直接轉成一筆 PlanStep 掛進時間軸,不需要額外的欄位轉換層。time 這裡
// 故意不預先填死,由「新增景點」工具呼叫時依目前時間軸現況決定插入的
// 時段——景點池本身只描述「這個地點是什麼」,不描述「它會被排在幾點」。

export interface PooledAttraction {
  id: string
  name: string
  kind: string
  duration: string
  desc: string
  thumbBg: string
  thumbIcon: string
  tags: string[]
  lat: number
  lng: number
}

// 台南安平/中西區一帶的景點,涵蓋 plan_sim_ws.go 既有腳本用過的幾個
// (赤崁樓/祀典武廟/安平古堡等,座標值保持一致,同一個地點在兩條路徑
// 底下不該有兩組不同座標)以及額外補充的幾個,讓查詢工具有更多可測試
// 的內容,不是照抄一份一模一樣的清單。
export const ATTRACTION_POOL: PooledAttraction[] = [
  {
    id: 'attr-chikanlou',
    name: '赤崁樓',
    kind: '景點',
    duration: '停留 1h',
    desc: '荷蘭時期普羅民遮城遺址，紅磚拱廊與燕尾脊並存，是台南地標之一。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B3A2F)',
    thumbIcon: '🏯',
    tags: ['門票 $70', '08:30 開館'],
    lat: 23.0009, lng: 120.2024,
  },
  {
    id: 'attr-wumiao',
    name: '祀典武廟',
    kind: '景點',
    duration: '停留 45 分',
    desc: '全台祀典中地位最高的關帝廟，山牆丹壁是台南著名的紅牆意象。',
    thumbBg: 'linear-gradient(135deg, #C0604A, #8B3A2F)',
    thumbIcon: '⛩️',
    tags: ['免費入場'],
    lat: 23.0006, lng: 120.2024,
  },
  {
    id: 'attr-datianhou',
    name: '大天后宮',
    kind: '景點',
    duration: '停留 30 分',
    desc: '全台第一座官建媽祖廟，見證明清政權交替下的信仰政策轉變。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #8B3A2F)',
    thumbIcon: '⛩️',
    tags: ['免費入場'],
    lat: 23.0006, lng: 120.1998,
  },
  {
    id: 'attr-anping-fort',
    name: '安平古堡',
    kind: '景點',
    duration: '停留 1.5h',
    desc: '1624 年荷蘭東印度公司築城據點，台江內海潟湖地形提供了天然良港。',
    thumbBg: 'linear-gradient(135deg, #7C6F5B, #2B2420)',
    thumbIcon: '🏰',
    tags: ['門票 $70', '瞭望台'],
    lat: 23.0016, lng: 120.1616,
  },
  {
    id: 'attr-anping-treehouse',
    name: '安平樹屋',
    kind: '景點',
    duration: '停留 45 分',
    desc: '老榕樹盤根錯節包覆廢棄倉庫，港口機能外移後被自然重新接管的見證。',
    thumbBg: 'linear-gradient(135deg, #5C6B57, #2B2420)',
    thumbIcon: '🌳',
    tags: ['與德記洋行聯票'],
    lat: 23.0037, lng: 120.1626,
  },
  {
    id: 'attr-anping-mazu',
    name: '安平天后宮',
    kind: '景點',
    duration: '停留 30 分',
    desc: '開台第一座媽祖廟，主祀鎮殿媽祖神像相傳隨鄭成功來台，廟埕保留早期安平聚落的生活紋理。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #8B3A2F)',
    thumbIcon: '⛩️',
    tags: ['免費入場'],
    lat: 22.9998, lng: 120.1642,
  },
  {
    id: 'attr-shennong',
    name: '神農街',
    kind: '晚餐・散策',
    duration: '停留 2h',
    desc: '老屋改建的文創街區，木造街屋與燈籠交錯，適合晚餐後散步收尾。',
    thumbBg: 'linear-gradient(135deg, #8B3A2F, #2B2420)',
    thumbIcon: '🏮',
    tags: ['約 $300/人', '夜間點燈'],
    lat: 22.9987, lng: 120.1971,
  },
  {
    id: 'attr-atang',
    name: '阿堂鹹粥',
    kind: '午餐',
    duration: '停留 1h',
    desc: '虱目魚粥與土魠魚羹的在地經典早午餐店，用餐時間常需排隊。',
    thumbBg: 'linear-gradient(135deg, #D9A97D, #C4956A)',
    thumbIcon: '🍚',
    tags: ['約 $150/人'],
    lat: 22.9976, lng: 120.1975,
  },
  {
    id: 'attr-hayashi',
    name: '林百貨',
    kind: '景點',
    duration: '停留 1h',
    desc: '1932 年落成的台南第一間百貨公司，戰後歷經數十年荒廢，2014 年整修重新開幕。',
    thumbBg: 'linear-gradient(135deg, #A67C52, #4A3626)',
    thumbIcon: '🏬',
    tags: ['頂樓神社遺跡', '約 $50/人'],
    lat: 22.9925, lng: 120.2028,
  },
  {
    id: 'attr-garden-night-market',
    name: '花園夜市',
    kind: '晚餐・散策',
    duration: '停留 2h',
    desc: '台南規模最大的觀光夜市，只在週四、六、日營業，小吃攤位密集。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #6B4A2E)',
    thumbIcon: '🎪',
    tags: ['約 $200/人', '限週四六日'],
    lat: 23.0129, lng: 120.2115,
  },
]

// findAttraction — 依名稱做寬鬆比對(不分大小寫、允許部分包含),供查詢
// 工具使用。回傳陣列而非單筆,因為使用者/agent 的查詢字串可能對到多筆
// (例如查「宮」會同時比對到大天后宮/安平天后宮),由呼叫端決定怎麼呈現
// 多筆結果,這個函式本身不做「只回第一筆」的過早收斂。
export function findAttraction(query: string): PooledAttraction[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return ATTRACTION_POOL.filter((a) => a.name.toLowerCase().includes(q))
}

// getAttractionById — 依 id 精確查找單筆,供新增工具使用(agent 呼叫
// add_attraction 時帶的是查詢工具回傳過的 id,不是重新打一次模糊比對)。
export function getAttractionById(id: string): PooledAttraction | undefined {
  return ATTRACTION_POOL.find((a) => a.id === id)
}
