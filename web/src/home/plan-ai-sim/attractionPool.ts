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
  // tags——選填(使用者明確要求「景點不要有費用資訊」,原本每筆金額
  // tag 拿掉後,幾筆條目已經沒有剩下任何 tag 可以顯示,對齊
  // AIPlanTimelinePage.tsx 渲染端本來就用 p.tags?.length > 0 判斷、
  // 安全處理沒有 tags 的情況,不強制每筆條目都要有這個欄位)。
  tags?: string[]
  lat: number
  lng: number
}

// 台南安平/中西區一帶的景點,涵蓋 plan_sim_ws.go 既有腳本用過的幾個
// (赤崁樓/祀典武廟/安平古堡等,座標值保持一致,同一個地點在兩條路徑
// 底下不該有兩組不同座標)以及額外補充的幾個,讓查詢工具有更多可測試
// 的內容,不是照抄一份一模一樣的清單。
export const ATTRACTION_POOL: PooledAttraction[] = [
  {
    id: 'attr-literature-museum',
    name: '國立臺灣文學館',
    kind: '景點',
    duration: '停留 1h',
    desc: '原台南州廳修復再利用，紅磚拱廊與現代圓弧量體並存，常設展呈現台灣文學發展脈絡。',
    thumbBg: 'linear-gradient(135deg, #B85C4A, #4A3626)',
    thumbIcon: '📚',
    tags: ['免費參觀'],
    lat: 22.9915, lng: 120.2039,
  },
  {
    id: 'attr-fire-museum',
    name: '臺南市消防史料館',
    kind: '景點',
    duration: '停留 45 分',
    desc: '原台南合同廳舍消防塔，展示古董消防車與裝備，設有兒童消防體驗區。',
    thumbBg: 'linear-gradient(135deg, #8B3A2F, #2B2420)',
    thumbIcon: '🚒',
    tags: ['免費參觀'],
    lat: 22.9946, lng: 120.2019,
  },
  {
    id: 'attr-confucius-temple',
    name: '孔廟',
    kind: '景點',
    duration: '停留 1h',
    desc: '1665 年創建的全台首學，紅牆綠瓦與百年老樹環繞，是台南人文歷史的重要地標。',
    thumbBg: 'linear-gradient(135deg, #8B7A2F, #4A3626)',
    thumbIcon: '🏛️',
    tags: ['免費開放參觀'],
    lat: 22.9908, lng: 120.2035,
  },
  {
    id: 'attr-confucius-temple-cultural-zone',
    name: '孔廟商圈',
    kind: '景點・散策',
    duration: '停留 1h',
    desc: '府中街一帶的文創聚落，老屋改建的選物店、手作工坊與小吃攤交錯，適合孔廟後接著散步逛街。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B7A2F)',
    thumbIcon: '🛍️',
    lat: 22.9902, lng: 120.2039,
  },
  {
    id: 'attr-xiaohaozhou-shacha',
    name: '小豪洲沙茶鍋',
    kind: '晚餐',
    duration: '停留 1.5h',
    desc: '在地老字號沙茶火鍋店，湯頭以沙茶炒香熬煮，配料新鮮實在，是台南人熟悉的晚餐選擇。',
    thumbBg: 'linear-gradient(135deg, #C0604A, #6B2E2A)',
    thumbIcon: '🍲',
    lat: 22.9938, lng: 120.2087,
  },
  {
    id: 'attr-chikanlou',
    name: '赤崁樓',
    kind: '景點',
    duration: '停留 1h',
    desc: '荷蘭時期普羅民遮城遺址，紅磚拱廊與燕尾脊並存，是台南地標之一。',
    thumbBg: 'linear-gradient(135deg, #C4956A, #8B3A2F)',
    thumbIcon: '🏯',
    tags: ['08:30 開館'],
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
    id: 'attr-wumiao-aiyu',
    name: '武廟愛玉',
    kind: '小吃',
    duration: '停留 20 分',
    desc: '祀典武廟廟埕旁的老字號愛玉冰攤，純手工洗愛玉，酸甜檸檬愛玉是招牌。',
    thumbBg: 'linear-gradient(135deg, #C4B15A, #8B7A2F)',
    thumbIcon: '🍧',
    lat: 23.0007, lng: 120.2025,
  },
  {
    id: 'attr-riann-fenghuangjuan',
    name: '日安良食鳳凰卷',
    kind: '小吃',
    duration: '停留 15 分',
    desc: '永福路老字號糕餅鋪，鳳凰卷酥皮薄脆內餡濃郁，是府城傳統伴手禮之一。',
    thumbBg: 'linear-gradient(135deg, #D9B87D, #A67C4A)',
    thumbIcon: '🥐',
    lat: 23.0008, lng: 120.2026,
  },
  {
    id: 'attr-yifeng-wintermelon',
    name: '義豐冬瓜茶',
    kind: '飲品',
    duration: '停留 10 分',
    desc: '永福路百年老店，古法熬煮冬瓜磚現煮冬瓜茶，逛廟後解渴的在地首選。',
    thumbBg: 'linear-gradient(135deg, #B8934A, #6B4A2E)',
    thumbIcon: '🥤',
    lat: 23.0005, lng: 120.2023,
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
    tags: ['瞭望台'],
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
    tags: ['夜間點燈'],
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
    tags: ['頂樓神社遺跡'],
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
    tags: ['限週四六日'],
    lat: 23.0129, lng: 120.2115,
  },
]

// getAttractionById — 依 id 精確查找單筆,供新增工具使用(agent 呼叫
// add_attraction 時帶的是查詢工具回傳過的 id,不是重新打一次模糊比對)。
export function getAttractionById(id: string): PooledAttraction | undefined {
  return ATTRACTION_POOL.find((a) => a.id === id)
}
